using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using CostTracking.Api.Storage;
using CostTracking.Tests.Fixtures;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace CostTracking.Tests.Integration;

public sealed class RecurringIncomeTests
{
    [Fact]
    public async Task Approval_retry_after_api_restart_returns_the_original_response_without_a_second_event()
    {
        var root = Path.Combine(Path.GetTempPath(), "cost-income-restart-" + Guid.NewGuid().ToString("N"));
        var key = Guid.NewGuid();
        string body = string.Empty;
        string? etag;
        Guid ruleId;
        Guid horseId;
        var approvalBody = string.Empty;
        try
        {
            using (var app = new TestApplication(root, deleteStorageRootOnDispose: false))
            using (var client = Client(app, TestIdentityIssuer.Alice))
            {
                _ = await Send(client, HttpMethod.Put, "/api/v1/account", 0,
                    "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
                horseId = await CreateHorse(client, 1, "Misty");
                using var rule = await Send(client, HttpMethod.Post, "/api/v1/income-rules", 2,
                    RuleBody(Schedule("2026-09-19"), 100, "Lessons", horseId));
                Assert.Equal(HttpStatusCode.Created, rule.StatusCode);
                using var ruleJson = JsonDocument.Parse(await rule.Content.ReadAsStringAsync());
                ruleId = ruleJson.RootElement.GetProperty("ruleId").GetGuid();
                approvalBody = ApproveBody("2026-09-20", 100, horseId);
                using var approval = await Send(client, HttpMethod.Post,
                    $"/api/v1/income-rules/{ruleId:D}/occurrences/2026-09-19/approve", 3, approvalBody, key);
                Assert.Equal(HttpStatusCode.OK, approval.StatusCode);
                body = await approval.Content.ReadAsStringAsync();
                etag = approval.Headers.ETag?.Tag;
            }

            using var restarted = new TestApplication(root, deleteStorageRootOnDispose: false);
            using var restartedClient = Client(restarted, TestIdentityIssuer.Alice);
            using var retry = await Send(restartedClient, HttpMethod.Post,
                $"/api/v1/income-rules/{ruleId:D}/occurrences/2026-09-19/approve", 3, approvalBody, key);
            Assert.Equal(HttpStatusCode.OK, retry.StatusCode);
            Assert.Equal(etag, retry.Headers.ETag?.Tag);
            Assert.Equal(body, await retry.Content.ReadAsStringAsync());
            Assert.Equal(4, (await restarted.Services.GetRequiredService<JsonlEventStore>()
                .ReadAsync(TestIdentityIssuer.Alice)).Count);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task Rule_revisions_are_listed_with_original_anchor_and_stop_is_terminal()
    {
        using var app = new TestApplication();
        using var client = Client(app, TestIdentityIssuer.Alice);
        _ = await Send(client, HttpMethod.Put, "/api/v1/account", 0, "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        var horseId = await CreateHorse(client, 1, "Misty");
        using var created = await Send(client, HttpMethod.Post, "/api/v1/income-rules", 2,
            RuleBody(Schedule("2026-09-19"), 100, "Lesson", horseId));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var createdJson = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var ruleId = createdJson.RootElement.GetProperty("ruleId").GetGuid();

        using var revision = await Send(client, HttpMethod.Patch, $"/api/v1/income-rules/{ruleId:D}", 3,
            ReviseRuleBody("2026-09-22", "2026-09-19", 125, "Training", horseId));
        Assert.Equal(HttpStatusCode.OK, revision.StatusCode);
        using var listed = await client.GetAsync("/api/v1/income-rules");
        Assert.Equal(HttpStatusCode.OK, listed.StatusCode);
        using var listJson = JsonDocument.Parse(await listed.Content.ReadAsStringAsync());
        var rule = Assert.Single(listJson.RootElement.GetProperty("items").EnumerateArray());
        Assert.Equal("2026-09-19", rule.GetProperty("startDate").GetString());
        Assert.Equal(2, rule.GetProperty("revisions").GetArrayLength());
        Assert.Equal("Lesson", rule.GetProperty("defaults").GetProperty("source").GetString());
        Assert.Equal("Training", rule.GetProperty("revisions")[1].GetProperty("defaults").GetProperty("source").GetString());

        using var badAnchor = await Send(client, HttpMethod.Patch, $"/api/v1/income-rules/{ruleId:D}", 4,
            ReviseRuleBody("2026-09-23", "2026-09-22", 150, "Lesson", horseId));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, badAnchor.StatusCode);
        using var stopped = await Send(client, HttpMethod.Post, $"/api/v1/income-rules/{ruleId:D}/stop", 4,
            "{\"lastDate\":\"2026-09-24\"}");
        Assert.Equal(HttpStatusCode.OK, stopped.StatusCode);
        using var reviseStopped = await Send(client, HttpMethod.Patch, $"/api/v1/income-rules/{ruleId:D}", 5,
            ReviseRuleBody("2026-09-25", "2026-09-19", 150, "Lesson", horseId));
        Assert.Equal(HttpStatusCode.Conflict, reviseStopped.StatusCode);
        Assert.Equal("rule_stopped", await ErrorCode(reviseStopped));
    }

    [Fact]
    public async Task Stopped_backlog_can_be_decided_out_of_order_and_only_approved_actuals_are_realized()
    {
        using var app = new TestApplication();
        using var client = Client(app, TestIdentityIssuer.Alice);
        _ = await Send(client, HttpMethod.Put, "/api/v1/account", 0, "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        var horseId = await CreateHorse(client, 1, "Misty");
        using var created = await Send(client, HttpMethod.Post, "/api/v1/income-rules", 2,
            RuleBody(Schedule("2026-09-19"), 100, "  Lesson  ", horseId));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var ruleJson = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var ruleId = ruleJson.RootElement.GetProperty("ruleId").GetGuid();
        using var stopped = await Send(client, HttpMethod.Post, $"/api/v1/income-rules/{ruleId:D}/stop", 3,
            "{\"lastDate\":\"2026-09-30\"}");
        Assert.Equal(HttpStatusCode.OK, stopped.StatusCode);

        var store = app.Services.GetRequiredService<JsonlEventStore>();
        var beforeRead = await store.ReadAsync(TestIdentityIssuer.Alice);
        using var inbox = await client.GetAsync("/api/v1/income-approvals");
        Assert.Equal(HttpStatusCode.OK, inbox.StatusCode);
        using var inboxJson = JsonDocument.Parse(await inbox.Content.ReadAsStringAsync());
        Assert.Equal("2026-09-19", inboxJson.RootElement.GetProperty("from").GetString());
        Assert.Equal("2026-09-21", inboxJson.RootElement.GetProperty("through").GetString());
        Assert.Equal("2026-09-21", inboxJson.RootElement.GetProperty("asOfDate").GetString());
        var due = inboxJson.RootElement.GetProperty("items").EnumerateArray().ToArray();
        Assert.Equal(3, due.Length);
        Assert.All(due, item => Assert.Equal("Lesson", item.GetProperty("source").GetString()));
        Assert.Equal(beforeRead.Count, (await store.ReadAsync(TestIdentityIssuer.Alice)).Count);

        using var futureDecision = await Send(client, HttpMethod.Post,
            $"/api/v1/income-rules/{ruleId:D}/occurrences/2026-09-22/approve", 4,
            ApproveBody("2026-09-22", 100, horseId));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, futureDecision.StatusCode);

        var approveKey = Guid.NewGuid();
        var editedApproval = ApproveBody("2026-09-21", 250, horseId);
        using var approved = await Send(client, HttpMethod.Post,
            $"/api/v1/income-rules/{ruleId:D}/occurrences/2026-09-20/approve", 4, editedApproval, approveKey);
        Assert.Equal(HttpStatusCode.OK, approved.StatusCode);
        using var approvedJson = JsonDocument.Parse(await approved.Content.ReadAsStringAsync());
        Assert.Equal("income-rule/" + ruleId.ToString("D").ToLowerInvariant() + "/2026-09-20",
            approvedJson.RootElement.GetProperty("realizedIncomeId").GetString());
        Assert.Equal("2026-09-21", approvedJson.RootElement.GetProperty("nextDueDate").GetString());
        using var retry = await Send(client, HttpMethod.Post,
            $"/api/v1/income-rules/{ruleId:D}/occurrences/2026-09-20/approve", 4, editedApproval, approveKey);
        Assert.Equal(HttpStatusCode.OK, retry.StatusCode);
        Assert.Equal(approved.Headers.ETag?.Tag, retry.Headers.ETag?.Tag);
        Assert.Equal(await approved.Content.ReadAsStringAsync(), await retry.Content.ReadAsStringAsync());
        using var alreadyDecided = await Send(client, HttpMethod.Post,
            $"/api/v1/income-rules/{ruleId:D}/occurrences/2026-09-20/reject", 5, "{}");
        Assert.Equal(HttpStatusCode.Conflict, alreadyDecided.StatusCode);
        Assert.Equal("already_decided", await ErrorCode(alreadyDecided));

        using var rejected = await Send(client, HttpMethod.Post,
            $"/api/v1/income-rules/{ruleId:D}/occurrences/2026-09-21/reject", 5, "{}");
        Assert.Equal(HttpStatusCode.OK, rejected.StatusCode);
        using var rejectedJson = JsonDocument.Parse(await rejected.Content.ReadAsStringAsync());
        Assert.Equal("2026-09-22", rejectedJson.RootElement.GetProperty("nextDueDate").GetString());
        using var approvedEarlier = await Send(client, HttpMethod.Post,
            $"/api/v1/income-rules/{ruleId:D}/occurrences/2026-09-19/approve", 6,
            ApproveBody("2026-09-20", 100, horseId));
        Assert.Equal(HttpStatusCode.OK, approvedEarlier.StatusCode);
        using var earlierJson = JsonDocument.Parse(await approvedEarlier.Content.ReadAsStringAsync());
        Assert.Equal("2026-09-22", earlierJson.RootElement.GetProperty("nextDueDate").GetString());

        var beforeFinalRead = await store.ReadAsync(TestIdentityIssuer.Alice);
        using var emptyInbox = await client.GetAsync("/api/v1/income-approvals");
        Assert.Equal(HttpStatusCode.OK, emptyInbox.StatusCode);
        using var emptyJson = JsonDocument.Parse(await emptyInbox.Content.ReadAsStringAsync());
        Assert.Empty(emptyJson.RootElement.GetProperty("items").EnumerateArray());
        Assert.Equal(beforeFinalRead.Count, (await store.ReadAsync(TestIdentityIssuer.Alice)).Count);

        using var realized = await client.GetAsync("/api/v1/income?from=2026-09-19&to=2026-09-21");
        Assert.Equal(HttpStatusCode.OK, realized.StatusCode);
        using var realizedJson = JsonDocument.Parse(await realized.Content.ReadAsStringAsync());
        var receipts = realizedJson.RootElement.GetProperty("items").EnumerateArray().ToArray();
        Assert.Equal(2, receipts.Length);
        Assert.Equal(new long[] { 100, 250 }, receipts.Select(item => item.GetProperty("amountMinor").GetInt64()));
        Assert.All(receipts, item => Assert.Equal("Lesson", item.GetProperty("source").GetString()));
        Assert.All(receipts, item => Assert.Equal("Recurring", item.GetProperty("origin").GetString()));
        using var monthly = await client.GetAsync("/api/v1/reports/monthly-pnl?month=2026-09");
        Assert.Equal(HttpStatusCode.OK, monthly.StatusCode);
        using var monthlyJson = JsonDocument.Parse(await monthly.Content.ReadAsStringAsync());
        Assert.Equal(350, monthlyJson.RootElement.GetProperty("items").EnumerateArray().Single()
            .GetProperty("incomeMinor").GetInt64());
    }

    [Fact]
    public async Task Approval_cursor_freezes_as_of_date_binds_window_and_reports_older_backlog_limits()
    {
        using var app = new TestApplication();
        using var client = Client(app, TestIdentityIssuer.Alice);
        _ = await Send(client, HttpMethod.Put, "/api/v1/account", 0, "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        var horseId = await CreateHorse(client, 1, "Misty");
        using var created = await Send(client, HttpMethod.Post, "/api/v1/income-rules", 2,
            RuleBody(Schedule("2026-09-19"), 100, "Lesson", horseId));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);

        using var inbox = await client.GetAsync("/api/v1/income-approvals?from=2026-09-19&through=2026-09-30&limit=1");
        Assert.Equal(HttpStatusCode.OK, inbox.StatusCode);
        using var inboxJson = JsonDocument.Parse(await inbox.Content.ReadAsStringAsync());
        Assert.Equal("2026-09-21", inboxJson.RootElement.GetProperty("through").GetString());
        var cursor = inboxJson.RootElement.GetProperty("nextCursor").GetString();
        Assert.NotNull(cursor);
        using var wrongWindow = await client.GetAsync("/api/v1/income-approvals?from=2026-09-18&through=2026-09-30&limit=1&cursor=" + Uri.EscapeDataString(cursor!));
        Assert.Equal(HttpStatusCode.BadRequest, wrongWindow.StatusCode);
        using var nextPage = await client.GetAsync("/api/v1/income-approvals?from=2026-09-19&through=2026-09-30&limit=1&cursor=" + Uri.EscapeDataString(cursor!));
        Assert.Equal(HttpStatusCode.OK, nextPage.StatusCode);
        using var reversedWindow = await client.GetAsync("/api/v1/income-approvals?from=2026-09-22&through=2026-09-21");
        Assert.Equal(HttpStatusCode.BadRequest, reversedWindow.StatusCode);
        using var defaultThrough = await client.GetAsync("/api/v1/income-approvals?from=2026-09-19&limit=1");
        Assert.Equal(HttpStatusCode.OK, defaultThrough.StatusCode);
        using var defaultThroughJson = JsonDocument.Parse(await defaultThrough.Content.ReadAsStringAsync());
        var defaultCursor = defaultThroughJson.RootElement.GetProperty("nextCursor").GetString();
        Assert.NotNull(defaultCursor);

        app.Clock.Advance(TimeSpan.FromDays(1));
        using var renewed = Client(app, TestIdentityIssuer.Alice);
        using var expired = await renewed.GetAsync("/api/v1/income-approvals?from=2026-09-19&through=2026-09-30&limit=1&cursor=" + Uri.EscapeDataString(cursor!));
        Assert.Equal(HttpStatusCode.Conflict, expired.StatusCode);
        Assert.Equal("cursor_expired", await ErrorCode(expired));
        using var defaultExpired = await renewed.GetAsync("/api/v1/income-approvals?from=2026-09-19&limit=1&cursor=" + Uri.EscapeDataString(defaultCursor!));
        Assert.Equal(HttpStatusCode.Conflict, defaultExpired.StatusCode);
        Assert.Equal("cursor_expired", await ErrorCode(defaultExpired));
    }

    [Fact]
    public async Task Decision_race_commits_one_final_event_and_inactive_unchanged_split_remains_settleable()
    {
        using var app = new TestApplication();
        using var client = Client(app, TestIdentityIssuer.Alice);
        _ = await Send(client, HttpMethod.Put, "/api/v1/account", 0, "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        var horseId = await CreateHorse(client, 1, "Misty");
        using var created = await Send(client, HttpMethod.Post, "/api/v1/income-rules", 2,
            RuleBody(Schedule("2026-09-20"), 100, "Lesson", horseId));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var ruleJson = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var ruleId = ruleJson.RootElement.GetProperty("ruleId").GetGuid();
        using var sold = await Send(client, HttpMethod.Put, $"/api/v1/horses/{horseId:D}/status", 3, "{\"status\":\"Sold\"}");
        Assert.Equal(HttpStatusCode.OK, sold.StatusCode);

        var approve = Send(client, HttpMethod.Post, $"/api/v1/income-rules/{ruleId:D}/occurrences/2026-09-20/approve", 4,
            ApproveBody("2026-09-21", 150, horseId));
        var reject = Send(client, HttpMethod.Post, $"/api/v1/income-rules/{ruleId:D}/occurrences/2026-09-20/reject", 4, "{}");
        using var first = await approve;
        using var second = await reject;
        var responses = new[] { first, second };
        Assert.Single(responses, response => response.StatusCode == HttpStatusCode.OK);
        Assert.Single(responses, response => response.StatusCode == HttpStatusCode.Conflict);
        var loser = responses.Single(response => response.StatusCode == HttpStatusCode.Conflict);
        Assert.Contains(await ErrorCode(loser), new[] { "already_decided", "version_conflict" });
        var events = await app.Services.GetRequiredService<JsonlEventStore>().ReadAsync(TestIdentityIssuer.Alice);
        Assert.Equal(1, events.Count(item => item.Type is "RecurringIncomeApproved" or "RecurringIncomeRejected"));
        using var inactiveUnchangedApproval = await Send(client, HttpMethod.Post,
            $"/api/v1/income-rules/{ruleId:D}/occurrences/2026-09-21/approve", 5,
            ApproveBody("2026-09-21", 150, horseId));
        Assert.Equal(HttpStatusCode.OK, inactiveUnchangedApproval.StatusCode);
        Assert.Equal(2, (await app.Services.GetRequiredService<JsonlEventStore>().ReadAsync(TestIdentityIssuer.Alice))
            .Count(item => item.Type is "RecurringIncomeApproved" or "RecurringIncomeRejected"));
    }

    [Fact]
    public async Task Changed_split_cannot_redirect_a_pending_income_to_an_inactive_horse()
    {
        using var app = new TestApplication();
        using var client = Client(app, TestIdentityIssuer.Alice);
        _ = await Send(client, HttpMethod.Put, "/api/v1/account", 0, "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        var originalHorse = await CreateHorse(client, 1, "Misty");
        var inactiveHorse = await CreateHorse(client, 2, "Storm");
        using var created = await Send(client, HttpMethod.Post, "/api/v1/income-rules", 3,
            RuleBody(Schedule("2026-09-19"), 100, "Lesson", originalHorse));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var ruleJson = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var ruleId = ruleJson.RootElement.GetProperty("ruleId").GetGuid();
        using var sold = await Send(client, HttpMethod.Put, $"/api/v1/horses/{inactiveHorse:D}/status", 4, "{\"status\":\"Sold\"}");
        Assert.Equal(HttpStatusCode.OK, sold.StatusCode);

        using var changedInactive = await Send(client, HttpMethod.Post,
            $"/api/v1/income-rules/{ruleId:D}/occurrences/2026-09-19/approve", 5,
            ApproveBody("2026-09-20", 125, inactiveHorse));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, changedInactive.StatusCode);
        Assert.Equal("inactive_horse", await ErrorCode(changedInactive));
        var events = await app.Services.GetRequiredService<JsonlEventStore>().ReadAsync(TestIdentityIssuer.Alice);
        Assert.DoesNotContain(events, item => item.Type is "RecurringIncomeApproved" or "RecurringIncomeRejected");
        Assert.Equal(5, events.Count);
    }

    [Fact]
    public async Task Oversized_pending_candidate_budget_and_foreign_rule_targets_are_rejected_without_writes()
    {
        using var app = new TestApplication();
        using var alice = Client(app, TestIdentityIssuer.Alice);
        using var bob = Client(app, TestIdentityIssuer.Bob);
        _ = await Send(alice, HttpMethod.Put, "/api/v1/account", 0, "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        _ = await Send(bob, HttpMethod.Put, "/api/v1/account", 0, "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        var aliceHorse = await CreateHorse(alice, 1, "Misty");
        var bobHorse = await CreateHorse(bob, 1, "Storm");
        var version = 2L;
        Guid foreignRuleId = Guid.Empty;
        for (var index = 0; index < 6; index++)
        {
            using var rule = await Send(alice, HttpMethod.Post, "/api/v1/income-rules", version,
                RuleBody(Schedule("2020-01-01"), 100, "Lesson", aliceHorse));
            Assert.Equal(HttpStatusCode.Created, rule.StatusCode);
            if (index == 0)
            {
                using var body = JsonDocument.Parse(await rule.Content.ReadAsStringAsync());
                foreignRuleId = body.RootElement.GetProperty("ruleId").GetGuid();
            }
            version++;
        }
        var store = app.Services.GetRequiredService<JsonlEventStore>();
        var beforeReads = await store.ReadAsync(TestIdentityIssuer.Alice);
        using var broadBacklog = await alice.GetAsync("/api/v1/income-approvals");
        Assert.Equal(HttpStatusCode.UnprocessableEntity, broadBacklog.StatusCode);
        Assert.Equal("interval_limit", await ErrorCode(broadBacklog));
        using var overBudget = await alice.GetAsync("/api/v1/income-approvals?from=2020-01-01&through=2024-12-31&limit=1");
        Assert.Equal(HttpStatusCode.UnprocessableEntity, overBudget.StatusCode);
        Assert.Equal("occurrence_limit", await ErrorCode(overBudget));
        Assert.Equal(beforeReads.Count, (await store.ReadAsync(TestIdentityIssuer.Alice)).Count);
        using var foreignDecision = await Send(bob, HttpMethod.Post,
            $"/api/v1/income-rules/{foreignRuleId:D}/occurrences/2026-09-20/reject", 2, "{}");
        Assert.Equal(HttpStatusCode.NotFound, foreignDecision.StatusCode);
        using var ownRule = await Send(bob, HttpMethod.Post, "/api/v1/income-rules", 2,
            RuleBody(Schedule("2026-09-19"), 100, "Lesson", bobHorse));
        Assert.Equal(HttpStatusCode.Created, ownRule.StatusCode);
        using var ownRuleJson = JsonDocument.Parse(await ownRule.Content.ReadAsStringAsync());
        var ownRuleId = ownRuleJson.RootElement.GetProperty("ruleId").GetGuid();
        using var foreignSplit = await Send(bob, HttpMethod.Post,
            $"/api/v1/income-rules/{ownRuleId:D}/occurrences/2026-09-20/approve", 3,
            ApproveBody("2026-09-21", 100, aliceHorse));
        Assert.Equal(HttpStatusCode.NotFound, foreignSplit.StatusCode);
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

    private static string RuleBody(string schedule, long amount, string source, Guid horseId) =>
        $"{{\"schedule\":{schedule},\"amountMinor\":{amount},\"source\":{JsonSerializer.Serialize(source)},\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{horseId:D}\"]}}}}";

    private static string ReviseRuleBody(string effectiveFrom, string anchor, long amount, string source, Guid horseId) =>
        $"{{\"effectiveFrom\":\"{effectiveFrom}\",\"schedule\":{Schedule(anchor)},\"amountMinor\":{amount},\"source\":{JsonSerializer.Serialize(source)},\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{horseId:D}\"]}}}}";

    private static string ApproveBody(string receivedDate, long amount, Guid horseId) =>
        $"{{\"receivedDate\":\"{receivedDate}\",\"amountMinor\":{amount},\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{horseId:D}\"]}}}}";

    private static Task<HttpResponseMessage> Send(HttpClient client, HttpMethod method, string path, long version,
        string body, Guid? key = null)
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
