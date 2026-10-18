using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using CostTracking.Api.Storage;
using CostTracking.Tests.Fixtures;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace CostTracking.Tests.Integration;

public sealed class RecurringExpenseTests
{
    [Fact]
    public async Task Rules_create_revise_stop_and_list_revisions_without_locking_settings_or_materializing_expenses()
    {
        using var app = new TestApplication();
        using var client = Client(app, TestIdentityIssuer.Alice);
        _ = await Send(client, HttpMethod.Put, "/api/v1/account", 0, "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        var horseId = await CreateHorse(client, 1, "Misty");
        var start = Schedule("2026-09-01");
        var createBody = RuleBody(start, 100, "Feed", horseId);
        var createKey = Guid.NewGuid();
        using var created = await Send(client, HttpMethod.Post, "/api/v1/expense-rules", 2, createBody, createKey);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var createdJson = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var ruleId = createdJson.RootElement.GetProperty("ruleId").GetGuid();
        Assert.Equal(3, createdJson.RootElement.GetProperty("streamVersion").GetInt64());
        using var retry = await Send(client, HttpMethod.Post, "/api/v1/expense-rules", 2, createBody, createKey);
        Assert.Equal(HttpStatusCode.Created, retry.StatusCode);
        Assert.Equal(created.Headers.ETag?.Tag, retry.Headers.ETag?.Tag);
        Assert.Equal(await created.Content.ReadAsStringAsync(), await retry.Content.ReadAsStringAsync());
        using var keyConflict = await Send(client, HttpMethod.Post, "/api/v1/expense-rules", 2,
            createBody.Replace("100", "101", StringComparison.Ordinal), createKey);
        Assert.Equal(HttpStatusCode.Conflict, keyConflict.StatusCode);
        Assert.Equal("idempotency_conflict", await ErrorCode(keyConflict));
        using var stale = await Send(client, HttpMethod.Post, "/api/v1/expense-rules", 2,
            RuleBody(start, 101, "Feed", horseId));
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal("version_conflict", await ErrorCode(stale));

        using var invalidRevision = await Send(client, HttpMethod.Patch, $"/api/v1/expense-rules/{ruleId:D}", 3,
            RuleRevisionBody("2026-09-21", start, 250, "Training", "Too early", horseId));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, invalidRevision.StatusCode);
        using var protectedOverride = await Send(client, HttpMethod.Put,
            $"/api/v1/expense-rules/{ruleId:D}/occurrences/2026-09-24", 3, "{\"action\":\"Skipped\",\"changed\":null}");
        Assert.Equal(HttpStatusCode.OK, protectedOverride.StatusCode);
        using var protectedRevision = await Send(client, HttpMethod.Patch, $"/api/v1/expense-rules/{ruleId:D}", 4,
            RuleRevisionBody("2026-09-24", start, 250, "Training", "Protected", horseId));
        Assert.Equal(HttpStatusCode.Conflict, protectedRevision.StatusCode);
        Assert.Equal("protected_occurrence", await ErrorCode(protectedRevision));

        var revisedSchedule = Schedule("2026-09-01");
        using var revised = await Send(client, HttpMethod.Patch, $"/api/v1/expense-rules/{ruleId:D}", 4,
            RuleRevisionBody("2026-09-25", revisedSchedule, 250, "Training", "Lesson", horseId));
        Assert.Equal(HttpStatusCode.OK, revised.StatusCode);
        using var protectedStop = await Send(client, HttpMethod.Post, $"/api/v1/expense-rules/{ruleId:D}/stop", 5,
            "{\"lastDate\":\"2026-09-23\"}");
        Assert.Equal(HttpStatusCode.Conflict, protectedStop.StatusCode);
        Assert.Equal("protected_occurrence", await ErrorCode(protectedStop));
        using var invalidStop = await Send(client, HttpMethod.Post, $"/api/v1/expense-rules/{ruleId:D}/stop", 5,
            "{\"lastDate\":\"2026-09-24\"}");
        Assert.Equal(HttpStatusCode.UnprocessableEntity, invalidStop.StatusCode);
        using var stopped = await Send(client, HttpMethod.Post, $"/api/v1/expense-rules/{ruleId:D}/stop", 5,
            "{\"lastDate\":\"2026-10-15\"}");
        Assert.Equal(HttpStatusCode.OK, stopped.StatusCode);

        var before = await app.Services.GetRequiredService<JsonlEventStore>().ReadAsync(TestIdentityIssuer.Alice);
        using var listed = await client.GetAsync("/api/v1/expense-rules?limit=10");
        Assert.Equal(HttpStatusCode.OK, listed.StatusCode);
        using var listJson = JsonDocument.Parse(await listed.Content.ReadAsStringAsync());
        var rule = Assert.Single(listJson.RootElement.GetProperty("items").EnumerateArray());
        Assert.Equal(2, rule.GetProperty("revisions").GetArrayLength());
        Assert.Equal("2026-10-15", rule.GetProperty("lastDate").GetString());
        Assert.Equal("2026-09-25", rule.GetProperty("revisions")[1].GetProperty("effectiveFrom").GetString());
        Assert.Equal(6, listJson.RootElement.GetProperty("streamVersion").GetInt64());

        using var expenses = await client.GetAsync("/api/v1/expenses?from=2026-09-24&to=2026-09-26");
        Assert.Equal(HttpStatusCode.OK, expenses.StatusCode);
        using var expensesJson = JsonDocument.Parse(await expenses.Content.ReadAsStringAsync());
        var virtualItems = expensesJson.RootElement.GetProperty("items").EnumerateArray().ToArray();
        Assert.Equal(3, virtualItems.Length);
        Assert.All(virtualItems, item => Assert.Equal("Recurring", item.GetProperty("origin").GetString()));
        Assert.Equal([100L, 250L, 250L], virtualItems.Select(item => item.GetProperty("amountMinor").GetInt64()));
        Assert.Equal("Skipped", virtualItems[0].GetProperty("occurrenceState").GetString());
        Assert.Equal(0, virtualItems[0].GetProperty("contributionMinor").GetInt64());

        using var monthly = await client.GetAsync("/api/v1/reports/monthly-pnl?month=2026-09");
        Assert.Equal(HttpStatusCode.OK, monthly.StatusCode);
        using var monthlyJson = JsonDocument.Parse(await monthly.Content.ReadAsStringAsync());
        Assert.Equal(3_800, monthlyJson.RootElement.GetProperty("items").EnumerateArray().Single()
            .GetProperty("expenseMinor").GetInt64());

        using var account = await client.GetAsync("/api/v1/account");
        using var accountJson = JsonDocument.Parse(await account.Content.ReadAsStringAsync());
        Assert.True(accountJson.RootElement.GetProperty("settingsLocked").GetBoolean());
        Assert.Equal(6, accountJson.RootElement.GetProperty("streamVersion").GetInt64());
        var after = await app.Services.GetRequiredService<JsonlEventStore>().ReadAsync(TestIdentityIssuer.Alice);
        Assert.Equal(before.Count, after.Count);
        Assert.Equal(0, after.Count(item => item.Type == "ExpenseRecorded"));
    }

    [Fact]
    public async Task Occurrences_can_be_changed_skipped_and_changed_again_without_materialized_expenses()
    {
        using var app = new TestApplication();
        using var client = Client(app, TestIdentityIssuer.Alice);
        _ = await Send(client, HttpMethod.Put, "/api/v1/account", 0, "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        var horseId = await CreateHorse(client, 1, "Misty");
        using var created = await Send(client, HttpMethod.Post, "/api/v1/expense-rules", 2,
            RuleBody(Schedule("2026-09-01"), 100, "Feed", horseId));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var ruleJson = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var ruleId = ruleJson.RootElement.GetProperty("ruleId").GetGuid();
        const string path = "/api/v1/expense-rules/";
        const string date = "2026-09-20";
        var overridePath = $"{path}{ruleId:D}/occurrences/{date}";
        using var changed = await Send(client, HttpMethod.Put, overridePath, 3,
            ChangedOverrideBody(250, "Other", "one date only", horseId));
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        using var skipped = await Send(client, HttpMethod.Put, overridePath, 4,
            "{\"action\":\"Skipped\",\"changed\":null}");
        Assert.Equal(HttpStatusCode.OK, skipped.StatusCode);
        using var restored = await Send(client, HttpMethod.Put, overridePath, 5,
            ChangedOverrideBody(400, "Veterinary", "restored", horseId));
        Assert.Equal(HttpStatusCode.OK, restored.StatusCode);

        var beforeRead = await app.Services.GetRequiredService<JsonlEventStore>().ReadAsync(TestIdentityIssuer.Alice);
        using var occurrences = await client.GetAsync("/api/v1/expenses?from=2026-09-19&to=2026-09-21");
        Assert.Equal(HttpStatusCode.OK, occurrences.StatusCode);
        using var rows = JsonDocument.Parse(await occurrences.Content.ReadAsStringAsync());
        var items = rows.RootElement.GetProperty("items").EnumerateArray().ToArray();
        Assert.Equal(3, items.Length);
        var changedDay = Assert.Single(items, item => item.GetProperty("expenseDate").GetString() == date);
        Assert.Equal(400, changedDay.GetProperty("amountMinor").GetInt64());
        Assert.Equal("Changed", changedDay.GetProperty("occurrenceState").GetString());
        Assert.False(changedDay.GetProperty("skipped").GetBoolean());
        Assert.Equal(400, changedDay.GetProperty("contributionMinor").GetInt64());
        Assert.Equal(100, items.Single(item => item.GetProperty("expenseDate").GetString() == "2026-09-19").GetProperty("amountMinor").GetInt64());
        Assert.Equal(100, items.Single(item => item.GetProperty("expenseDate").GetString() == "2026-09-21").GetProperty("amountMinor").GetInt64());
        Assert.Equal(beforeRead.Count, (await app.Services.GetRequiredService<JsonlEventStore>().ReadAsync(TestIdentityIssuer.Alice)).Count);
        Assert.Equal(0, beforeRead.Count(item => item.Type == "ExpenseRecorded"));
    }

    [Fact]
    public async Task Existing_inactive_obligation_can_be_kept_but_new_inactive_targets_are_rejected()
    {
        using var app = new TestApplication();
        using var client = Client(app, TestIdentityIssuer.Alice);
        _ = await Send(client, HttpMethod.Put, "/api/v1/account", 0, "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        var originalHorse = await CreateHorse(client, 1, "Misty");
        var inactiveTarget = await CreateHorse(client, 2, "Storm");
        using var created = await Send(client, HttpMethod.Post, "/api/v1/expense-rules", 3,
            RuleBody(Schedule("2026-09-01"), 100, "Feed", originalHorse));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var createdJson = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var ruleId = createdJson.RootElement.GetProperty("ruleId").GetGuid();
        using var originalSold = await Send(client, HttpMethod.Put, $"/api/v1/horses/{originalHorse:D}/status", 4, "{\"status\":\"Sold\"}");
        Assert.Equal(HttpStatusCode.OK, originalSold.StatusCode);
        using var targetSold = await Send(client, HttpMethod.Put, $"/api/v1/horses/{inactiveTarget:D}/status", 5, "{\"status\":\"Sold\"}");
        Assert.Equal(HttpStatusCode.OK, targetSold.StatusCode);
        using var retained = await Send(client, HttpMethod.Put,
            $"/api/v1/expense-rules/{ruleId:D}/occurrences/2026-09-20",
            6, ChangedOverrideBody(200, "Feed", "retain original obligation", originalHorse));
        Assert.Equal(HttpStatusCode.OK, retained.StatusCode);
        using var rejected = await Send(client, HttpMethod.Put,
            $"/api/v1/expense-rules/{ruleId:D}/occurrences/2026-09-20",
            7, ChangedOverrideBody(300, "Feed", "new inactive target", inactiveTarget));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, rejected.StatusCode);
        Assert.Equal("inactive_horse", await ErrorCode(rejected));
        using var account = await client.GetAsync("/api/v1/account");
        using var accountJson = JsonDocument.Parse(await account.Content.ReadAsStringAsync());
        Assert.Equal(7, accountJson.RootElement.GetProperty("streamVersion").GetInt64());
    }

    [Fact]
    public async Task Rules_and_occurrence_mutations_hide_foreign_ids_and_validate_categories_dates_and_targets()
    {
        using var app = new TestApplication();
        using var alice = Client(app, TestIdentityIssuer.Alice);
        using var bob = Client(app, TestIdentityIssuer.Bob);
        _ = await Send(alice, HttpMethod.Put, "/api/v1/account", 0, "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        _ = await Send(bob, HttpMethod.Put, "/api/v1/account", 0, "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        var aliceHorse = await CreateHorse(alice, 1, "Misty");
        var bobHorse = await CreateHorse(bob, 1, "Storm");
        using var invalidCategory = await Send(alice, HttpMethod.Post, "/api/v1/expense-rules", 2,
            RuleBody(Schedule("2026-09-01"), 100, "Driving", aliceHorse));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, invalidCategory.StatusCode);
        using var invalidSchedule = await Send(alice, HttpMethod.Post, "/api/v1/expense-rules", 2,
            RuleBody(Schedule("2026-09-01").Replace("\"interval\":1", "\"interval\":0", StringComparison.Ordinal), 100, "Feed", aliceHorse));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, invalidSchedule.StatusCode);
        using var invalidAmount = await Send(alice, HttpMethod.Post, "/api/v1/expense-rules", 2,
            RuleBody(Schedule("2026-09-01"), 0, "Feed", aliceHorse));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, invalidAmount.StatusCode);
        using var created = await Send(bob, HttpMethod.Post, "/api/v1/expense-rules", 2,
            RuleBody(Schedule("2026-09-01"), 100, "Feed", bobHorse));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var ruleJson = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var foreignRuleId = ruleJson.RootElement.GetProperty("ruleId").GetGuid();
        using var foreignRevise = await Send(alice, HttpMethod.Patch, $"/api/v1/expense-rules/{foreignRuleId:D}", 2,
            RuleRevisionBody("2026-09-25", Schedule("2026-09-01"), 100, "Feed", "Hay", aliceHorse));
        Assert.Equal(HttpStatusCode.NotFound, foreignRevise.StatusCode);
        using var foreignStop = await Send(alice, HttpMethod.Post, $"/api/v1/expense-rules/{foreignRuleId:D}/stop", 2,
            "{\"lastDate\":\"2026-10-01\"}");
        Assert.Equal(HttpStatusCode.NotFound, foreignStop.StatusCode);
        using var foreignHistory = await alice.GetAsync($"/api/v1/history?ruleId={foreignRuleId:D}");
        Assert.Equal(HttpStatusCode.NotFound, foreignHistory.StatusCode);
    }

    [Fact]
    public async Task Query_candidate_budget_is_checked_before_page_size_and_horse_filter()
    {
        using var app = new TestApplication();
        using var client = Client(app, TestIdentityIssuer.Alice);
        _ = await Send(client, HttpMethod.Put, "/api/v1/account", 0, "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        var horseId = await CreateHorse(client, 1, "Misty");
        var version = 2L;
        var start = "2020-01-01";
        for (var index = 0; index < 6; index++)
        {
            using var rule = await Send(client, HttpMethod.Post, "/api/v1/expense-rules", version,
                RuleBody(Schedule(start), 100, "Feed", horseId));
            Assert.Equal(HttpStatusCode.Created, rule.StatusCode);
            version++;
        }
        using var overBudget = await client.GetAsync("/api/v1/expenses?from=2020-01-01&to=2024-12-31&horseId=" + horseId.ToString("D") + "&limit=1");
        Assert.Equal(HttpStatusCode.UnprocessableEntity, overBudget.StatusCode);
        Assert.Equal("occurrence_limit", await ErrorCode(overBudget));
    }

    [Fact]
    public async Task Rule_cursor_binds_page_size_and_expires_after_any_stream_change()
    {
        using var app = new TestApplication();
        using var client = Client(app, TestIdentityIssuer.Alice);
        _ = await Send(client, HttpMethod.Put, "/api/v1/account", 0, "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        var horseId = await CreateHorse(client, 1, "Misty");
        using var firstRule = await Send(client, HttpMethod.Post, "/api/v1/expense-rules", 2,
            RuleBody(Schedule("2026-09-01"), 100, "Feed", horseId));
        Assert.Equal(HttpStatusCode.Created, firstRule.StatusCode);
        using var secondRule = await Send(client, HttpMethod.Post, "/api/v1/expense-rules", 3,
            RuleBody(Schedule("2026-09-02"), 200, "Feed", horseId));
        Assert.Equal(HttpStatusCode.Created, secondRule.StatusCode);

        using var pageOne = await client.GetAsync("/api/v1/expense-rules?limit=1");
        Assert.Equal(HttpStatusCode.OK, pageOne.StatusCode);
        using var pageOneJson = JsonDocument.Parse(await pageOne.Content.ReadAsStringAsync());
        var cursor = pageOneJson.RootElement.GetProperty("nextCursor").GetString();
        Assert.NotNull(cursor);
        using var mismatch = await client.GetAsync("/api/v1/expense-rules?limit=2&cursor=" + Uri.EscapeDataString(cursor!));
        Assert.Equal(HttpStatusCode.BadRequest, mismatch.StatusCode);
        using var pageTwo = await client.GetAsync("/api/v1/expense-rules?limit=1&cursor=" + Uri.EscapeDataString(cursor!));
        Assert.Equal(HttpStatusCode.OK, pageTwo.StatusCode);

        using var thirdRule = await Send(client, HttpMethod.Post, "/api/v1/expense-rules", 4,
            RuleBody(Schedule("2026-09-03"), 300, "Feed", horseId));
        Assert.Equal(HttpStatusCode.Created, thirdRule.StatusCode);
        using var expired = await client.GetAsync("/api/v1/expense-rules?limit=1&cursor=" + Uri.EscapeDataString(cursor!));
        Assert.Equal(HttpStatusCode.Conflict, expired.StatusCode);
        Assert.Equal("cursor_expired", await ErrorCode(expired));
    }

    [Fact]
    public async Task Concurrent_rule_creates_from_one_version_commit_exactly_once()
    {
        using var app = new TestApplication();
        using var client = Client(app, TestIdentityIssuer.Alice);
        _ = await Send(client, HttpMethod.Put, "/api/v1/account", 0, "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        var horseId = await CreateHorse(client, 1, "Misty");
        var first = Send(client, HttpMethod.Post, "/api/v1/expense-rules", 2,
            RuleBody(Schedule("2026-09-01"), 100, "Feed", horseId));
        var second = Send(client, HttpMethod.Post, "/api/v1/expense-rules", 2,
            RuleBody(Schedule("2026-09-02"), 200, "Feed", horseId));

        using var firstResponse = await first;
        using var secondResponse = await second;

        var statuses = new[] { firstResponse.StatusCode, secondResponse.StatusCode };
        Assert.Single(statuses, status => status == HttpStatusCode.Created);
        Assert.Single(statuses, status => status == HttpStatusCode.Conflict);
        Assert.Equal("version_conflict", await ErrorCode(firstResponse.StatusCode == HttpStatusCode.Conflict ? firstResponse : secondResponse));
        using var list = await client.GetAsync("/api/v1/expense-rules");
        using var json = JsonDocument.Parse(await list.Content.ReadAsStringAsync());
        Assert.Single(json.RootElement.GetProperty("items").EnumerateArray());
        Assert.Equal(3, json.RootElement.GetProperty("streamVersion").GetInt64());
    }

    private static HttpClient Client(TestApplication app, string subject)
    {
        var client = app.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", app.Identity.Issue(subject, app.Clock.GetUtcNow()));
        return client;
    }

    private static async Task<Guid> CreateHorse(HttpClient client, long version, string name)
    {
        using var response = await Send(client, HttpMethod.Post, "/api/v1/horses", version,
            JsonSerializer.Serialize(new { name, breed = "Arabian", dateOfBirth = (string?)null, status = "Active" }));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.GetProperty("horseId").GetGuid();
    }

    private static string Schedule(string start) => JsonSerializer.Serialize(new
    {
        cadence = "Daily", interval = 1, weekdays = Array.Empty<int>(), dayOfMonth = (int?)null,
        startDate = start, endDate = (string?)null
    });

    private static string RuleBody(string schedule, long amount, string category, Guid horseId) =>
        $"{{\"schedule\":{schedule},\"amountMinor\":{amount},\"category\":{JsonSerializer.Serialize(category)},\"description\":\"Hay\",\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{horseId:D}\"]}}}}";

    private static string RuleRevisionBody(string effectiveFrom, string schedule, long amount, string category, string description, Guid horseId) =>
        $"{{\"effectiveFrom\":\"{effectiveFrom}\",\"schedule\":{schedule},\"amountMinor\":{amount},\"category\":{JsonSerializer.Serialize(category)},\"description\":{JsonSerializer.Serialize(description)},\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{horseId:D}\"]}}}}";

    private static string ChangedOverrideBody(long amount, string category, string description, Guid horseId) =>
        $"{{\"action\":\"Changed\",\"changed\":{{\"amountMinor\":{amount},\"category\":{JsonSerializer.Serialize(category)},\"description\":{JsonSerializer.Serialize(description)},\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{horseId:D}\"]}}}}}}";

    private static Task<HttpResponseMessage> Send(HttpClient client, HttpMethod method, string path, long version, string body, Guid? key = null)
    {
        var request = new HttpRequestMessage(method, path) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        request.Headers.TryAddWithoutValidation("Idempotency-Key", (key ?? Guid.NewGuid()).ToString("D"));
        request.Headers.TryAddWithoutValidation("If-Match", $"\"{version}\"");
        return client.SendAsync(request);
    }

    private static async Task<string?> ErrorCode(HttpResponseMessage response)
    {
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.GetProperty("code").GetString();
    }
}
