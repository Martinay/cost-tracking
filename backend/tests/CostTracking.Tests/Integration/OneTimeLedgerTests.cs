using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using CostTracking.Tests.Fixtures;
using Microsoft.AspNetCore.Mvc.Testing;

namespace CostTracking.Tests.Integration;

public sealed class OneTimeLedgerTests
{
    [Fact]
    public async Task Financial_commands_require_setup_and_reject_dates_after_owner_today()
    {
        using var app = new TestApplication();
        using var client = Client(app, TestIdentityIssuer.Alice);
        const string expense = "{\"expenseDate\":\"2026-09-22\",\"amountMinor\":1001,\"category\":\"Farrier\",\"description\":\"Trim\",\"split\":{\"mode\":\"Equal\",\"horseIds\":[\"00000001-0000-4000-8000-000000000001\"]}}";

        using var beforeSetup = await Send(client, HttpMethod.Post, "/api/v1/expenses", 0, expense);
        Assert.Equal(HttpStatusCode.Conflict, beforeSetup.StatusCode);
        Assert.Equal("account_setup_required", await ErrorCode(beforeSetup));

        using var configured = await Send(client, HttpMethod.Put, "/api/v1/account", 0,
            "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        Assert.Equal(HttpStatusCode.OK, configured.StatusCode);
        using var horse = await Send(client, HttpMethod.Post, "/api/v1/horses", 1,
            "{\"name\":\"Misty\",\"breed\":\"Arabian\",\"dateOfBirth\":null,\"status\":\"Active\"}");
        using var horseBody = JsonDocument.Parse(await horse.Content.ReadAsStringAsync());
        var horseId = horseBody.RootElement.GetProperty("horseId").GetGuid();
        var futureExpense = $"{{\"expenseDate\":\"2026-09-22\",\"amountMinor\":1001,\"category\":\"Farrier\",\"description\":\"Trim\",\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{horseId:D}\"]}}}}";

        using var rejected = await Send(client, HttpMethod.Post, "/api/v1/expenses", 2, futureExpense);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, rejected.StatusCode);
        Assert.Equal("future_financial_date", await ErrorCode(rejected));
        using var account = await client.GetAsync("/api/v1/account");
        using var accountBody = JsonDocument.Parse(await account.Content.ReadAsStringAsync());
        Assert.False(accountBody.RootElement.GetProperty("settingsLocked").GetBoolean());
        Assert.Equal(2, accountBody.RootElement.GetProperty("streamVersion").GetInt64());

        var valid = $"{{\"expenseDate\":\"2026-09-21\",\"amountMinor\":1001,\"category\":\"Farrier\",\"description\":\"Trim\",\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{horseId:D}\"]}}}}";
        var key = Guid.NewGuid();
        using var accepted = await Send(client, HttpMethod.Post, "/api/v1/expenses", 2, valid, key);
        Assert.Equal(HttpStatusCode.Created, accepted.StatusCode);
        using var changedBody = await Send(client, HttpMethod.Post, "/api/v1/expenses", 2, valid.Replace("1001", "1002", StringComparison.Ordinal), key);
        Assert.Equal(HttpStatusCode.Conflict, changedBody.StatusCode);
        Assert.Equal("idempotency_conflict", await ErrorCode(changedBody));
        using var lockedAccount = await client.GetAsync("/api/v1/account");
        using var lockedJson = JsonDocument.Parse(await lockedAccount.Content.ReadAsStringAsync());
        Assert.True(lockedJson.RootElement.GetProperty("settingsLocked").GetBoolean());
    }

    [Fact]
    public async Task Equal_expense_and_income_store_exact_shares_and_same_key_replays_original_result()
    {
        using var app = new TestApplication();
        using var client = Client(app, TestIdentityIssuer.Alice);
        using var configured = await Send(client, HttpMethod.Put, "/api/v1/account", 0,
            "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        var firstHorse = await CreateHorse(client, 1, "Misty");
        var secondHorse = await CreateHorse(client, 2, "Storm");
        var ids = new[] { firstHorse, secondHorse }.OrderBy(id => id.ToString("D").ToLowerInvariant(), StringComparer.Ordinal).ToArray();
        var expenseBody = $"{{\"expenseDate\":\"2026-09-21\",\"amountMinor\":1001,\"category\":\"Farrier\",\"description\":\"Trim\",\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{ids[0]:D}\",\"{ids[1]:D}\"]}}}}";
        var key = Guid.NewGuid();

        using var expense = await Send(client, HttpMethod.Post, "/api/v1/expenses", 3, expenseBody, key);
        Assert.Equal(HttpStatusCode.Created, expense.StatusCode);
        using var expenseJson = JsonDocument.Parse(await expense.Content.ReadAsStringAsync());
        var expenseId = expenseJson.RootElement.GetProperty("expenseId").GetGuid();
        Assert.Equal(4, expenseJson.RootElement.GetProperty("streamVersion").GetInt64());
        Assert.Equal([501L, 500L], expenseJson.RootElement.GetProperty("allocations").EnumerateArray()
            .Select(item => item.GetProperty("amountMinor").GetInt64()));

        using var retry = await Send(client, HttpMethod.Post, "/api/v1/expenses", 0, expenseBody, key);
        Assert.Equal(HttpStatusCode.Created, retry.StatusCode);
        Assert.Equal(expense.Headers.ETag?.Tag, retry.Headers.ETag?.Tag);
        Assert.Equal(await expense.Content.ReadAsStringAsync(), await retry.Content.ReadAsStringAsync());

        const string source = "  Lesson income  ";
        var incomeBody = $"{{\"receivedDate\":\"2026-09-21\",\"amountMinor\":2000,\"source\":{JsonSerializer.Serialize(source)},\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{ids[0]:D}\",\"{ids[1]:D}\"]}}}}";
        using var income = await Send(client, HttpMethod.Post, "/api/v1/income", 4, incomeBody);
        Assert.Equal(HttpStatusCode.Created, income.StatusCode);
        using var incomeJson = JsonDocument.Parse(await income.Content.ReadAsStringAsync());
        Assert.Equal(5, incomeJson.RootElement.GetProperty("streamVersion").GetInt64());
        Assert.Equal([1000L, 1000L], incomeJson.RootElement.GetProperty("allocations").EnumerateArray()
            .Select(item => item.GetProperty("amountMinor").GetInt64()));
        Assert.NotEqual(Guid.Empty, expenseId);
        using var history = await client.GetAsync("/api/v1/history");
        using var historyJson = JsonDocument.Parse(await history.Content.ReadAsStringAsync());
        Assert.Contains(historyJson.RootElement.GetProperty("items").EnumerateArray(), item => item.GetProperty("type").GetString() == "ExpenseRecorded");
        Assert.Contains(historyJson.RootElement.GetProperty("items").EnumerateArray(), item => item.GetProperty("type").GetString() == "IncomeRecorded");
        using var expenseList = await client.GetAsync("/api/v1/expenses?from=2026-09-21&to=2026-09-21");
        using var expenseListJson = JsonDocument.Parse(await expenseList.Content.ReadAsStringAsync());
        Assert.Equal(1, expenseListJson.RootElement.GetProperty("items").GetArrayLength());
        Assert.Equal(1001, expenseListJson.RootElement.GetProperty("items")[0].GetProperty("contributionMinor").GetInt64());
        Assert.Equal([501L, 500L], expenseListJson.RootElement.GetProperty("items")[0].GetProperty("allocations").EnumerateArray()
            .Select(item => item.GetProperty("amountMinor").GetInt64()));
        using var incomeList = await client.GetAsync("/api/v1/income?from=2026-09-21&to=2026-09-21&horseId=" + ids[1].ToString("D"));
        using var incomeListJson = JsonDocument.Parse(await incomeList.Content.ReadAsStringAsync());
        Assert.Equal(1, incomeListJson.RootElement.GetProperty("items").GetArrayLength());
        Assert.Equal(1000, incomeListJson.RootElement.GetProperty("items")[0].GetProperty("contributionMinor").GetInt64());
        using var monthly = await client.GetAsync("/api/v1/reports/monthly-pnl?month=2026-09");
        using var monthlyJson = JsonDocument.Parse(await monthly.Content.ReadAsStringAsync());
        Assert.Equal(2, monthlyJson.RootElement.GetProperty("items").GetArrayLength());
        Assert.Equal([499L, 500L], monthlyJson.RootElement.GetProperty("items").EnumerateArray()
            .Select(item => item.GetProperty("netMinor").GetInt64()));
        using var lifetimeFirst = await client.GetAsync("/api/v1/reports/lifetime?limit=1");
        using var lifetimeFirstJson = JsonDocument.Parse(await lifetimeFirst.Content.ReadAsStringAsync());
        Assert.False(lifetimeFirstJson.RootElement.GetProperty("complete").GetBoolean());
        var lifetimeCursor = lifetimeFirstJson.RootElement.GetProperty("nextCursor").GetString();
        Assert.NotNull(lifetimeCursor);
        using var wrongFilter = await client.GetAsync("/api/v1/reports/lifetime?limit=1&horseId=" + ids[1].ToString("D") + "&cursor=" + Uri.EscapeDataString(lifetimeCursor!));
        Assert.Equal(HttpStatusCode.BadRequest, wrongFilter.StatusCode);
        using var lifetimeSecond = await client.GetAsync("/api/v1/reports/lifetime?limit=1&cursor=" + Uri.EscapeDataString(lifetimeCursor!));
        using var lifetimeSecondJson = JsonDocument.Parse(await lifetimeSecond.Content.ReadAsStringAsync());
        Assert.True(lifetimeSecondJson.RootElement.GetProperty("complete").GetBoolean());
        Assert.Null(lifetimeSecondJson.RootElement.GetProperty("nextCursor").GetString());
        using var appended = await Send(client, HttpMethod.Post, "/api/v1/expenses", 5,
            $"{{\"expenseDate\":\"2026-09-21\",\"amountMinor\":100,\"category\":\"Feed\",\"description\":\"Hay\",\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{ids[0]:D}\"]}}}}");
        Assert.Equal(HttpStatusCode.Created, appended.StatusCode);
        using var expiredLifetime = await client.GetAsync("/api/v1/reports/lifetime?limit=1&cursor=" + Uri.EscapeDataString(lifetimeCursor!));
        Assert.Equal(HttpStatusCode.Conflict, expiredLifetime.StatusCode);
    }

    [Fact]
    public async Task Preview_is_read_only_and_financial_settings_lock_only_after_commit()
    {
        using var app = new TestApplication();
        using var client = Client(app, TestIdentityIssuer.Alice);
        using var configured = await Send(client, HttpMethod.Put, "/api/v1/account", 0,
            "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        var id = await CreateHorse(client, 1, "Misty");
        var previewBody = $"{{\"kind\":\"Expense\",\"values\":{{\"expenseDate\":\"2026-09-21\",\"amountMinor\":1001,\"category\":\"Farrier\",\"description\":\"Trim\",\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{id:D}\"]}}}}}}";

        using var preview = await client.PostAsync("/api/v1/previews/financial", new StringContent(previewBody, Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.OK, preview.StatusCode);
        using var previewJson = JsonDocument.Parse(await preview.Content.ReadAsStringAsync());
        Assert.Equal(1001, previewJson.RootElement.GetProperty("amountMinor").GetInt64());
        Assert.Equal(2, previewJson.RootElement.GetProperty("streamVersion").GetInt64());
        using var account = await client.GetAsync("/api/v1/account");
        using var accountJson = JsonDocument.Parse(await account.Content.ReadAsStringAsync());
        Assert.Equal(2, accountJson.RootElement.GetProperty("streamVersion").GetInt64());
        Assert.False(accountJson.RootElement.GetProperty("settingsLocked").GetBoolean());
    }

    [Fact]
    public async Task New_financial_splits_reject_inactive_targets_and_hide_foreign_ids()
    {
        using var app = new TestApplication();
        using var client = Client(app, TestIdentityIssuer.Alice);
        using var configured = await Send(client, HttpMethod.Put, "/api/v1/account", 0,
            "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        var id = await CreateHorse(client, 1, "Misty");
        using var sold = await Send(client, HttpMethod.Put, $"/api/v1/horses/{id:D}/status", 2, "{\"status\":\"Sold\"}");
        Assert.Equal(HttpStatusCode.OK, sold.StatusCode);
        var inactive = $"{{\"expenseDate\":\"2026-09-21\",\"amountMinor\":100,\"category\":\"Feed\",\"description\":\"Hay\",\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{id:D}\"]}}}}";
        var foreign = inactive.Replace(id.ToString("D"), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", StringComparison.Ordinal);

        using var inactiveResponse = await Send(client, HttpMethod.Post, "/api/v1/expenses", 3, inactive);
        using var foreignResponse = await Send(client, HttpMethod.Post, "/api/v1/expenses", 3, foreign);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, inactiveResponse.StatusCode);
        Assert.Equal("inactive_horse", await ErrorCode(inactiveResponse));
        Assert.Equal(HttpStatusCode.NotFound, foreignResponse.StatusCode);
        Assert.Equal("not_found", await ErrorCode(foreignResponse));
    }

    [Fact]
    public async Task Every_ordinary_expense_category_is_accepted_and_driving_is_separate()
    {
        using var app = new TestApplication();
        using var client = Client(app, TestIdentityIssuer.Alice);
        using var configured = await Send(client, HttpMethod.Put, "/api/v1/account", 0,
            "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        var horseId = await CreateHorse(client, 1, "Misty");
        var version = 2L;
        foreach (var category in new[] { "Stabling", "Veterinary", "Farrier", "Feed", "Equipment", "Training", "Other" })
        {
            var body = $"{{\"expenseDate\":\"2026-09-21\",\"amountMinor\":101,\"category\":\"{category}\",\"description\":\"{category}\",\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{horseId:D}\"]}}}}";
            using var result = await Send(client, HttpMethod.Post, "/api/v1/expenses", version, body);
            Assert.Equal(HttpStatusCode.Created, result.StatusCode);
            version++;
        }
        using var driving = await Send(client, HttpMethod.Post, "/api/v1/expenses", version,
            $"{{\"expenseDate\":\"2026-09-21\",\"amountMinor\":101,\"category\":\"Driving\",\"description\":\"Trip\",\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{horseId:D}\"]}}}}");
        Assert.Equal(HttpStatusCode.UnprocessableEntity, driving.StatusCode);
        Assert.Equal("invalid_expense_category", await ErrorCode(driving));
        using var history = await client.GetAsync("/api/v1/history");
        using var historyJson = JsonDocument.Parse(await history.Content.ReadAsStringAsync());
        Assert.Equal(7, historyJson.RootElement.GetProperty("items").EnumerateArray()
            .Count(item => item.GetProperty("type").GetString() == "ExpenseRecorded"));
    }

    [Fact]
    public async Task Preview_is_version_bound_by_the_command_and_can_be_recomputed_after_conflict()
    {
        using var app = new TestApplication();
        using var client = Client(app, TestIdentityIssuer.Alice);
        using var configured = await Send(client, HttpMethod.Put, "/api/v1/account", 0,
            "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        var first = await CreateHorse(client, 1, "Misty");
        var body = $"{{\"expenseDate\":\"2026-09-21\",\"amountMinor\":1001,\"category\":\"Farrier\",\"description\":\"Trim\",\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{first:D}\"]}}}}";
        using var preview = await PreviewExpense(client, body);
        using var previewJson = JsonDocument.Parse(await preview.Content.ReadAsStringAsync());
        Assert.Equal(2, previewJson.RootElement.GetProperty("streamVersion").GetInt64());

        _ = await CreateHorse(client, 2, "Storm");
        using var staleCommit = await Send(client, HttpMethod.Post, "/api/v1/expenses", 2, body);
        Assert.Equal(HttpStatusCode.Conflict, staleCommit.StatusCode);
        Assert.Equal("version_conflict", await ErrorCode(staleCommit));

        using var currentPreview = await PreviewExpense(client, body);
        using var currentJson = JsonDocument.Parse(await currentPreview.Content.ReadAsStringAsync());
        Assert.Equal(3, currentJson.RootElement.GetProperty("streamVersion").GetInt64());
        using var commit = await Send(client, HttpMethod.Post, "/api/v1/expenses", 3, body);
        Assert.Equal(HttpStatusCode.Created, commit.StatusCode);
    }

    [Fact]
    public async Task Monthly_report_accepts_the_last_calendar_month()
    {
        using var app = new TestApplication();
        using var client = Client(app, TestIdentityIssuer.Alice);
        using var configured = await Send(client, HttpMethod.Put, "/api/v1/account", 0,
            "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");

        using var report = await client.GetAsync("/api/v1/reports/monthly-pnl?month=9999-12");

        Assert.Equal(HttpStatusCode.OK, report.StatusCode);
        using var body = JsonDocument.Parse(await report.Content.ReadAsStringAsync());
        Assert.Equal("9999-12", body.RootElement.GetProperty("month").GetString());
        Assert.Empty(body.RootElement.GetProperty("items").EnumerateArray());
    }

    [Fact]
    public async Task Driving_preview_uses_explicit_or_saved_rate_without_committing()
    {
        using var app = new TestApplication();
        using var client = Client(app, TestIdentityIssuer.Alice);
        using var configured = await Send(client, HttpMethod.Put, "/api/v1/account", 0,
            "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        var horseId = await CreateHorse(client, 1, "Misty");
        const string drivingValues = "{\"expenseDate\":\"2026-09-21\",\"kilometers\":10.125,\"rateMinorPerKm\":30,\"description\":\"Lesson trip\",\"split\":{\"mode\":\"Equal\",\"horseIds\":[\"{HORSE}\"]}}";
        var values = drivingValues.Replace("{HORSE}", horseId.ToString("D"), StringComparison.Ordinal);

        using var preview = await client.PostAsync("/api/v1/previews/financial", new StringContent(
            "{\"kind\":\"Driving\",\"values\":" + values + "}", Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.OK, preview.StatusCode);
        using var body = JsonDocument.Parse(await preview.Content.ReadAsStringAsync());
        Assert.Equal(304, body.RootElement.GetProperty("amountMinor").GetInt64());
        Assert.Equal(10.125m, body.RootElement.GetProperty("driving").GetProperty("kilometers").GetDecimal());
        Assert.Equal(30m, body.RootElement.GetProperty("driving").GetProperty("rateMinorPerKm").GetDecimal());
        Assert.Equal(304, body.RootElement.GetProperty("monthlyEffect")[0].GetProperty("expenseDeltaMinor").GetInt64());
        Assert.Equal(2, body.RootElement.GetProperty("streamVersion").GetInt64());
        using var account = await client.GetAsync("/api/v1/account");
        using var accountJson = JsonDocument.Parse(await account.Content.ReadAsStringAsync());
        Assert.False(accountJson.RootElement.GetProperty("settingsLocked").GetBoolean());
        Assert.Equal(2, accountJson.RootElement.GetProperty("streamVersion").GetInt64());
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

    private static Task<HttpResponseMessage> Send(HttpClient client, HttpMethod method, string path, long version,
        string body, Guid? key = null)
    {
        var request = new HttpRequestMessage(method, path) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        request.Headers.TryAddWithoutValidation("Idempotency-Key", (key ?? Guid.NewGuid()).ToString("D"));
        request.Headers.TryAddWithoutValidation("If-Match", $"\"{version}\"");
        return client.SendAsync(request);
    }

    private static Task<HttpResponseMessage> PreviewExpense(HttpClient client, string expenseBody)
    {
        var body = "{\"kind\":\"Expense\",\"values\":" + expenseBody + "}";
        return client.PostAsync("/api/v1/previews/financial", new StringContent(body, Encoding.UTF8, "application/json"));
    }

    private static async Task<string?> ErrorCode(HttpResponseMessage response)
    {
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.GetProperty("code").GetString();
    }
}
