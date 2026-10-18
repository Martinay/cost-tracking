using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using CostTracking.Tests.Fixtures;
using Microsoft.AspNetCore.Mvc.Testing;

namespace CostTracking.Tests.Integration;

public sealed class ReportTests
{
    [Fact]
    public async Task Mixed_monthly_breakdowns_reconcile_effective_allocations_and_quantity_only_activity()
    {
        using var app = new TestApplication();
        using var client = Client(app, TestIdentityIssuer.Alice);
        _ = await Send(client, HttpMethod.Put, "/api/v1/account", 0, "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        var firstHorse = await CreateHorse(client, 1, "Misty");
        var secondHorse = await CreateHorse(client, 2, "Storm");
        using var expense = await Send(client, HttpMethod.Post, "/api/v1/expenses", 3,
            ExpenseBody(1_001, "Farrier", firstHorse, secondHorse));
        Assert.Equal(HttpStatusCode.Created, expense.StatusCode);
        using var expenseRule = await Send(client, HttpMethod.Post, "/api/v1/expense-rules", 4,
            ExpenseRuleBody(100, firstHorse));
        Assert.Equal(HttpStatusCode.Created, expenseRule.StatusCode);
        using var expenseRuleJson = JsonDocument.Parse(await expenseRule.Content.ReadAsStringAsync());
        var expenseRuleId = expenseRuleJson.RootElement.GetProperty("ruleId").GetGuid();
        using var changed = await Send(client, HttpMethod.Put,
            $"/api/v1/expense-rules/{expenseRuleId:D}/occurrences/2026-09-20", 5,
            ChangedExpenseBody(300, firstHorse));
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        using var skipped = await Send(client, HttpMethod.Put,
            $"/api/v1/expense-rules/{expenseRuleId:D}/occurrences/2026-09-20", 6,
            "{\"action\":\"Skipped\",\"changed\":null}");
        Assert.Equal(HttpStatusCode.OK, skipped.StatusCode);

        using var income = await Send(client, HttpMethod.Post, "/api/v1/income", 7,
            IncomeBody(1_200, "  Lessons  ", firstHorse, secondHorse));
        Assert.Equal(HttpStatusCode.Created, income.StatusCode);
        using var incomeRule = await Send(client, HttpMethod.Post, "/api/v1/income-rules", 8,
            IncomeRuleBody(firstHorse, secondHorse));
        Assert.Equal(HttpStatusCode.Created, incomeRule.StatusCode);
        using var incomeRuleJson = JsonDocument.Parse(await incomeRule.Content.ReadAsStringAsync());
        var incomeRuleId = incomeRuleJson.RootElement.GetProperty("ruleId").GetGuid();
        using var approved = await Send(client, HttpMethod.Post,
            $"/api/v1/income-rules/{incomeRuleId:D}/occurrences/2026-09-19/approve", 9,
            ApproveBody(1_500, firstHorse, secondHorse));
        Assert.Equal(HttpStatusCode.OK, approved.StatusCode);
        using var rejected = await Send(client, HttpMethod.Post,
            $"/api/v1/income-rules/{incomeRuleId:D}/occurrences/2026-09-20/reject", 10, "{}");
        Assert.Equal(HttpStatusCode.OK, rejected.StatusCode);
        using var sold = await Send(client, HttpMethod.Put, $"/api/v1/horses/{secondHorse:D}/status", 11,
            "{\"status\":\"Sold\"}");
        Assert.Equal(HttpStatusCode.OK, sold.StatusCode);

        using var monthly = await client.GetAsync("/api/v1/reports/monthly-pnl?month=2026-09");
        Assert.Equal(HttpStatusCode.OK, monthly.StatusCode);
        using var monthlyJson = JsonDocument.Parse(await monthly.Content.ReadAsStringAsync());
        var balances = monthlyJson.RootElement.GetProperty("items").EnumerateArray().ToArray();
        Assert.Equal(2, balances.Length); // Sold horses remain in reports.
        Assert.Equal((1_350L, 701L, 649L), BalanceFor(balances, firstHorse));
        Assert.Equal((1_350L, 500L, 850L), BalanceFor(balances, secondHorse));

        using var activity = await Send(client, HttpMethod.Post, "/api/v1/tasks", 12,
            TaskBody(firstHorse));
        Assert.Equal(HttpStatusCode.Created, activity.StatusCode);
        using var activityReport = await client.GetAsync("/api/v1/reports/activity?from=2026-09-19&to=2026-09-21");
        Assert.Equal(HttpStatusCode.OK, activityReport.StatusCode);
        using var activityJson = JsonDocument.Parse(await activityReport.Content.ReadAsStringAsync());
        var grooming = Assert.Single(activityJson.RootElement.GetProperty("items").EnumerateArray());
        Assert.Equal("Grooming", grooming.GetProperty("taskType").GetString());
        Assert.Equal(1, grooming.GetProperty("count").GetInt32());
        Assert.Equal(0, grooming.GetProperty("minutes").GetInt64());
        using var monthlyAfterTask = await client.GetAsync("/api/v1/reports/monthly-pnl?month=2026-09");
        using var afterTaskJson = JsonDocument.Parse(await monthlyAfterTask.Content.ReadAsStringAsync());
        Assert.Equal(balances.Select(SerializeBalance), afterTaskJson.RootElement.GetProperty("items").EnumerateArray().Select(item => item.GetRawText()));

        using var expenses = await client.GetAsync("/api/v1/reports/breakdown?from=2026-09-19&to=2026-09-21&kind=expense");
        Assert.Equal(HttpStatusCode.OK, expenses.StatusCode);
        using var expenseJson = JsonDocument.Parse(await expenses.Content.ReadAsStringAsync());
        Assert.Equal("EUR", expenseJson.RootElement.GetProperty("currency").GetString());
        Assert.Equal(1_201, expenseJson.RootElement.GetProperty("totalMinor").GetInt64());
        Assert.Equal(200, Assert.Single(expenseJson.RootElement.GetProperty("items").EnumerateArray(), item => item.GetProperty("label").GetString() == "Feed").GetProperty("amountMinor").GetInt64());
        using var horseExpense = await client.GetAsync($"/api/v1/reports/breakdown?from=2026-09-19&to=2026-09-21&kind=expense&horseId={secondHorse:D}");
        Assert.Equal(HttpStatusCode.OK, horseExpense.StatusCode);
        using var horseExpenseJson = JsonDocument.Parse(await horseExpense.Content.ReadAsStringAsync());
        Assert.Equal(500, horseExpenseJson.RootElement.GetProperty("totalMinor").GetInt64());
        using var incomeBreakdown = await client.GetAsync("/api/v1/reports/breakdown?from=2026-09-19&to=2026-09-21&kind=income");
        Assert.Equal(HttpStatusCode.OK, incomeBreakdown.StatusCode);
        using var incomeJson = JsonDocument.Parse(await incomeBreakdown.Content.ReadAsStringAsync());
        Assert.Equal(2_700, incomeJson.RootElement.GetProperty("totalMinor").GetInt64());
        Assert.Equal(2_700, Assert.Single(incomeJson.RootElement.GetProperty("items").EnumerateArray(), item => item.GetProperty("label").GetString() == "Lessons").GetProperty("amountMinor").GetInt64());
        using var horseIncome = await client.GetAsync($"/api/v1/reports/breakdown?from=2026-09-19&to=2026-09-21&kind=income&horseId={secondHorse:D}");
        Assert.Equal(HttpStatusCode.OK, horseIncome.StatusCode);
        using var horseIncomeJson = JsonDocument.Parse(await horseIncome.Content.ReadAsStringAsync());
        Assert.Equal(1_350, horseIncomeJson.RootElement.GetProperty("totalMinor").GetInt64());
    }

    [Fact]
    public async Task Lifetime_batches_bound_occurrence_work_and_expire_after_nonfinancial_appends()
    {
        using var app = new TestApplication();
        using var client = Client(app, TestIdentityIssuer.Alice);
        _ = await Send(client, HttpMethod.Put, "/api/v1/account", 0, "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        var horseId = await CreateHorse(client, 1, "Misty");
        var version = 2L;
        for (var index = 0; index < 6; index++)
        {
            using var created = await Send(client, HttpMethod.Post, "/api/v1/expense-rules", version,
                DailyExpenseRuleBody(horseId));
            Assert.Equal(HttpStatusCode.Created, created.StatusCode);
            version++;
        }

        var firstPage = await client.GetAsync("/api/v1/reports/lifetime?limit=1");
        using (firstPage)
        {
            Assert.Equal(HttpStatusCode.OK, firstPage.StatusCode);
            using var firstJson = JsonDocument.Parse(await firstPage.Content.ReadAsStringAsync());
            Assert.False(firstJson.RootElement.GetProperty("complete").GetBoolean());
            var cursor = firstJson.RootElement.GetProperty("nextCursor").GetString();
            Assert.NotNull(cursor);
            Assert.Equal(8, firstJson.RootElement.GetProperty("streamVersion").GetInt64());
            Assert.Equal("2026-09-21", firstJson.RootElement.GetProperty("asOfDate").GetString());

            using var secondPage = await client.GetAsync("/api/v1/reports/lifetime?limit=1&cursor=" + Uri.EscapeDataString(cursor!));
            Assert.Equal(HttpStatusCode.OK, secondPage.StatusCode);
            using var secondJson = JsonDocument.Parse(await secondPage.Content.ReadAsStringAsync());
            Assert.True(secondJson.RootElement.GetProperty("complete").GetBoolean());
            Assert.Null(secondJson.RootElement.GetProperty("nextCursor").GetString());
            Assert.Equal(8, secondJson.RootElement.GetProperty("streamVersion").GetInt64());
            Assert.Equal(firstJson.RootElement.GetProperty("asOfDate").GetString(), secondJson.RootElement.GetProperty("asOfDate").GetString());
            var totalExpenses = firstJson.RootElement.GetProperty("items")[0].GetProperty("expenseMinor").GetInt64() +
                secondJson.RootElement.GetProperty("items")[0].GetProperty("expenseMinor").GetInt64();
            Assert.Equal(6L * (D(2026, 9, 21).DayNumber - D(2020, 1, 1).DayNumber + 1), totalExpenses);

            using var task = await Send(client, HttpMethod.Post, "/api/v1/tasks", 8, TaskBody(horseId));
            Assert.Equal(HttpStatusCode.Created, task.StatusCode);
            using var expired = await client.GetAsync("/api/v1/reports/lifetime?limit=1&cursor=" + Uri.EscapeDataString(cursor!));
            Assert.Equal(HttpStatusCode.Conflict, expired.StatusCode);
            Assert.Equal("cursor_expired", await ErrorCode(expired));
        }
    }

    [Fact]
    public async Task Breakdown_enforces_subject_privacy_window_and_candidate_budgets()
    {
        using var app = new TestApplication();
        using var alice = Client(app, TestIdentityIssuer.Alice);
        using var bob = Client(app, TestIdentityIssuer.Bob);
        _ = await Send(alice, HttpMethod.Put, "/api/v1/account", 0, "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        _ = await Send(bob, HttpMethod.Put, "/api/v1/account", 0, "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        var aliceHorse = await CreateHorse(alice, 1, "Misty");
        var bobHorse = await CreateHorse(bob, 1, "Storm");
        var version = 2L;
        for (var index = 0; index < 6; index++)
        {
            using var rule = await Send(alice, HttpMethod.Post, "/api/v1/expense-rules", version,
                DailyExpenseRuleBody(aliceHorse));
            Assert.Equal(HttpStatusCode.Created, rule.StatusCode);
            version++;
        }

        using var foreign = await alice.GetAsync($"/api/v1/reports/breakdown?from=2026-09-19&to=2026-09-21&kind=expense&horseId={bobHorse:D}");
        Assert.Equal(HttpStatusCode.NotFound, foreign.StatusCode);
        using var overlong = await alice.GetAsync("/api/v1/reports/breakdown?from=2020-01-01&to=2025-01-01&kind=expense");
        Assert.Equal(HttpStatusCode.UnprocessableEntity, overlong.StatusCode);
        Assert.Equal("interval_limit", await ErrorCode(overlong));
        using var overBudget = await alice.GetAsync($"/api/v1/reports/breakdown?from=2020-01-01&to=2024-12-31&kind=expense&horseId={aliceHorse:D}&limit=1");
        Assert.Equal(HttpStatusCode.UnprocessableEntity, overBudget.StatusCode);
        Assert.Equal("occurrence_limit", await ErrorCode(overBudget));
        using var malformedKind = await alice.GetAsync("/api/v1/reports/breakdown?from=2026-09-19&to=2026-09-21&kind=Expense");
        Assert.Equal(HttpStatusCode.BadRequest, malformedKind.StatusCode);
        Assert.Equal("malformed_request", await ErrorCode(malformedKind));
    }

    private static (long Income, long Expense, long Net) BalanceFor(JsonElement[] items, Guid horseId)
    {
        var item = Assert.Single(items, row => row.GetProperty("horseId").GetGuid() == horseId);
        return (item.GetProperty("incomeMinor").GetInt64(), item.GetProperty("expenseMinor").GetInt64(), item.GetProperty("netMinor").GetInt64());
    }

    private static string SerializeBalance(JsonElement item) => item.GetRawText();

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

    private static string ExpenseBody(long amount, string category, params Guid[] horses) => JsonSerializer.Serialize(new
    {
        expenseDate = "2026-09-19", amountMinor = amount, category, description = "Trim",
        split = new { mode = "Equal", horseIds = horses }
    });

    private static string ExpenseRuleBody(long amount, Guid horseId) => JsonSerializer.Serialize(new
    {
        schedule = ScheduleValue("2026-09-19", "2026-09-21"), amountMinor = amount, category = "Feed", description = "Hay",
        split = new { mode = "Equal", horseIds = new[] { horseId } }
    });

    private static string DailyExpenseRuleBody(Guid horseId) => JsonSerializer.Serialize(new
    {
        schedule = ScheduleValue("2020-01-01", null), amountMinor = 1L, category = "Feed", description = "Hay",
        split = new { mode = "Equal", horseIds = new[] { horseId } }
    });

    private static string ChangedExpenseBody(long amount, Guid horseId) => JsonSerializer.Serialize(new
    {
        action = "Changed", changed = new
        {
            amountMinor = amount, category = "Feed", description = "Hay adjusted",
            split = new { mode = "Equal", horseIds = new[] { horseId } }
        }
    });

    private static string IncomeBody(long amount, string source, params Guid[] horses) => JsonSerializer.Serialize(new
    {
        receivedDate = "2026-09-19", amountMinor = amount, source,
        split = new { mode = "Equal", horseIds = horses }
    });

    private static string IncomeRuleBody(Guid first, Guid second) => JsonSerializer.Serialize(new
    {
        schedule = ScheduleValue("2026-09-19", "2026-09-21"), amountMinor = 1_000L, source = "Lessons",
        split = new { mode = "Equal", horseIds = new[] { first, second } }
    });

    private static string ApproveBody(long amount, Guid first, Guid second) => JsonSerializer.Serialize(new
    {
        receivedDate = "2026-09-20", amountMinor = amount,
        split = new { mode = "Equal", horseIds = new[] { first, second } }
    });

    private static string TaskBody(Guid horseId) => JsonSerializer.Serialize(new
    {
        horseId, taskDate = "2026-09-20", taskType = "Grooming", minutes = 0, quantity = 1.5m, quantityUnit = "hours", notes = ""
    });

    private static object ScheduleValue(string start, string? end) => new
    {
        cadence = "Daily", interval = 1, weekdays = Array.Empty<int>(), dayOfMonth = (int?)null,
        startDate = start, endDate = end
    };

    private static Task<HttpResponseMessage> Send(HttpClient client, HttpMethod method, string path, long version, string body)
    {
        var request = new HttpRequestMessage(method, path) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        request.Headers.TryAddWithoutValidation("Idempotency-Key", Guid.NewGuid().ToString("D"));
        request.Headers.TryAddWithoutValidation("If-Match", $"\"{version}\"");
        return client.SendAsync(request);
    }

    private static async Task<string?> ErrorCode(HttpResponseMessage response)
    {
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.GetProperty("code").GetString();
    }

    private static DateOnly D(int year, int month, int day) => new(year, month, day);
}
