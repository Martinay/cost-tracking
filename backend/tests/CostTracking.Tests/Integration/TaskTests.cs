using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using CostTracking.Tests.Fixtures;

namespace CostTracking.Tests.Integration;

public sealed class TaskTests
{
    [Fact]
    public async Task Tasks_are_created_listed_and_grouped_with_quantity_only_minutes_as_zero()
    {
        using var app = new TestApplication();
        using var client = AuthenticatedClient(app, TestIdentityIssuer.Alice);
        var horseId = await CreateHorse(client);

        using var first = await SendCommand(client, HttpMethod.Post, "/api/v1/tasks", 1,
            $"{{\"horseId\":\"{horseId:D}\",\"taskDate\":\"2026-09-20\",\"taskType\":\"Riding\",\"minutes\":45,\"quantity\":null,\"quantityUnit\":null,\"notes\":\"Hill work\"}}");
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        using var firstBody = JsonDocument.Parse(await first.Content.ReadAsStringAsync());
        Assert.Equal(2, firstBody.RootElement.GetProperty("streamVersion").GetInt64());

        using var second = await SendCommand(client, HttpMethod.Post, "/api/v1/tasks", 2,
            $"{{\"horseId\":\"{horseId:D}\",\"taskDate\":\"2026-09-20\",\"taskType\":\"PaddockDuty\",\"quantity\":2.5,\"quantityUnit\":\"hours\"}}");
        Assert.Equal(HttpStatusCode.Created, second.StatusCode);

        using var pageOne = await client.GetAsync($"/api/v1/tasks?from=2026-09-19&to=2026-09-21&horseId={horseId:D}&limit=1");
        Assert.Equal(HttpStatusCode.OK, pageOne.StatusCode);
        using var pageOneBody = JsonDocument.Parse(await pageOne.Content.ReadAsStringAsync());
        var cursor = pageOneBody.RootElement.GetProperty("nextCursor").GetString();
        Assert.NotNull(cursor);
        var firstItem = Assert.Single(pageOneBody.RootElement.GetProperty("items").EnumerateArray());
        Assert.Equal("Riding", firstItem.GetProperty("taskType").GetString());
        Assert.Equal(45, firstItem.GetProperty("minutes").GetInt64());
        Assert.Equal(JsonValueKind.Null, firstItem.GetProperty("quantity").ValueKind);
        Assert.Equal(JsonValueKind.Null, firstItem.GetProperty("quantityUnit").ValueKind);
        Assert.Equal("Hill work", firstItem.GetProperty("notes").GetString());

        using var changedFilter = await client.GetAsync($"/api/v1/tasks?from=2026-09-19&to=2026-09-21&horseId={horseId:D}&taskType=PaddockDuty&limit=1&cursor={Uri.EscapeDataString(cursor!)}");
        Assert.Equal(HttpStatusCode.BadRequest, changedFilter.StatusCode);

        using var pageTwo = await client.GetAsync($"/api/v1/tasks?from=2026-09-19&to=2026-09-21&horseId={horseId:D}&limit=1&cursor={Uri.EscapeDataString(cursor!)}");
        Assert.Equal(HttpStatusCode.OK, pageTwo.StatusCode);
        using var pageTwoBody = JsonDocument.Parse(await pageTwo.Content.ReadAsStringAsync());
        var quantityOnly = Assert.Single(pageTwoBody.RootElement.GetProperty("items").EnumerateArray());
        Assert.Equal("PaddockDuty", quantityOnly.GetProperty("taskType").GetString());
        Assert.Equal(0, quantityOnly.GetProperty("minutes").GetInt64());
        Assert.Equal(2.5m, quantityOnly.GetProperty("quantity").GetDecimal());
        Assert.Equal("hours", quantityOnly.GetProperty("quantityUnit").GetString());
        Assert.Equal("", quantityOnly.GetProperty("notes").GetString());
        Assert.Equal(JsonValueKind.Null, pageTwoBody.RootElement.GetProperty("nextCursor").ValueKind);

        using var filtered = await client.GetAsync($"/api/v1/tasks?from=2026-09-19&to=2026-09-21&taskType=Riding");
        Assert.Equal(HttpStatusCode.OK, filtered.StatusCode);
        using var filteredBody = JsonDocument.Parse(await filtered.Content.ReadAsStringAsync());
        Assert.Equal("Riding", Assert.Single(filteredBody.RootElement.GetProperty("items").EnumerateArray()).GetProperty("taskType").GetString());

        using var report = await client.GetAsync($"/api/v1/reports/activity?from=2026-09-19&to=2026-09-21&horseId={horseId:D}");
        Assert.Equal(HttpStatusCode.OK, report.StatusCode);
        using var reportBody = JsonDocument.Parse(await report.Content.ReadAsStringAsync());
        var summaries = reportBody.RootElement.GetProperty("items").EnumerateArray().ToDictionary(
            item => item.GetProperty("taskType").GetString()!, item => item);
        Assert.Equal(1, summaries["Riding"].GetProperty("count").GetInt32());
        Assert.Equal(45, summaries["Riding"].GetProperty("minutes").GetInt64());
        Assert.Equal(1, summaries["PaddockDuty"].GetProperty("count").GetInt32());
        Assert.Equal(0, summaries["PaddockDuty"].GetProperty("minutes").GetInt64());

        using var third = await SendCommand(client, HttpMethod.Post, "/api/v1/tasks", 3, TaskBody(horseId, "2026-09-21"));
        Assert.Equal(HttpStatusCode.Created, third.StatusCode);
        using var staleCursor = await client.GetAsync($"/api/v1/tasks?from=2026-09-19&to=2026-09-21&horseId={horseId:D}&limit=1&cursor={Uri.EscapeDataString(cursor!)}");
        Assert.Equal(HttpStatusCode.Conflict, staleCursor.StatusCode);
        Assert.Equal("cursor_expired", await ErrorCode(staleCursor));
    }

    [Fact]
    public async Task Task_cursor_expires_on_stream_change_and_filters_hide_foreign_horses()
    {
        using var app = new TestApplication();
        using var alice = AuthenticatedClient(app, TestIdentityIssuer.Alice);
        using var bob = AuthenticatedClient(app, TestIdentityIssuer.Bob);
        var horseId = await CreateHorse(alice);

        using var firstTask = await SendCommand(alice, HttpMethod.Post, "/api/v1/tasks", 1, TaskBody(horseId, "2026-09-19"));
        using var secondTask = await SendCommand(alice, HttpMethod.Post, "/api/v1/tasks", 2, TaskBody(horseId, "2026-09-20"));
        Assert.Equal(HttpStatusCode.Created, firstTask.StatusCode);
        Assert.Equal(HttpStatusCode.Created, secondTask.StatusCode);

        using var pageOne = await alice.GetAsync("/api/v1/tasks?from=2026-09-19&to=2026-09-21&limit=1");
        Assert.Equal(HttpStatusCode.OK, pageOne.StatusCode);
        using var pageOneBody = JsonDocument.Parse(await pageOne.Content.ReadAsStringAsync());
        var cursor = pageOneBody.RootElement.GetProperty("nextCursor").GetString();
        Assert.NotNull(cursor);

        var existingUnknown = Guid.Parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
        using var foreignFilter = await bob.GetAsync($"/api/v1/tasks?from=2026-09-19&to=2026-09-21&horseId={horseId:D}");
        using var absentFilter = await bob.GetAsync($"/api/v1/tasks?from=2026-09-19&to=2026-09-21&horseId={existingUnknown:D}");
        Assert.Equal(HttpStatusCode.NotFound, foreignFilter.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, absentFilter.StatusCode);
        Assert.Equal(await ErrorCode(foreignFilter), await ErrorCode(absentFilter));

        using var foreignReport = await bob.GetAsync($"/api/v1/reports/activity?from=2026-09-19&to=2026-09-21&horseId={horseId:D}");
        using var absentReport = await bob.GetAsync($"/api/v1/reports/activity?from=2026-09-19&to=2026-09-21&horseId={existingUnknown:D}");
        Assert.Equal(HttpStatusCode.NotFound, foreignReport.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, absentReport.StatusCode);
        Assert.Equal(await ErrorCode(foreignReport), await ErrorCode(absentReport));

        using var thirdTask = await SendCommand(alice, HttpMethod.Post, "/api/v1/tasks", 3, TaskBody(horseId, "2026-09-21"));
        Assert.Equal(HttpStatusCode.Created, thirdTask.StatusCode);
        using var staleCursor = await alice.GetAsync($"/api/v1/tasks?from=2026-09-19&to=2026-09-21&limit=1&cursor={Uri.EscapeDataString(cursor!)}");
        Assert.Equal(HttpStatusCode.Conflict, staleCursor.StatusCode);
        Assert.Equal("cursor_expired", await ErrorCode(staleCursor));
    }

    [Fact]
    public async Task Task_commands_hide_foreign_horses_reject_inactive_and_future_dates()
    {
        using var app = new TestApplication();
        using var alice = AuthenticatedClient(app, TestIdentityIssuer.Alice);
        using var bob = AuthenticatedClient(app, TestIdentityIssuer.Bob);
        var horseId = await CreateHorse(alice);
        const string date = "2026-09-20";
        var foreignBody = TaskBody(horseId, date);
        using var foreign = await SendCommand(bob, HttpMethod.Post, "/api/v1/tasks", 0, foreignBody);
        using var absent = await SendCommand(bob, HttpMethod.Post, "/api/v1/tasks", 0,
            TaskBody(Guid.Parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), date));
        Assert.Equal(HttpStatusCode.NotFound, foreign.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, absent.StatusCode);
        Assert.Equal(await ErrorCode(foreign), await ErrorCode(absent));

        using var retired = await SendCommand(alice, HttpMethod.Put, $"/api/v1/horses/{horseId:D}/status", 1,
            "{\"status\":\"Retired\"}");
        Assert.Equal(HttpStatusCode.OK, retired.StatusCode);
        using var inactiveTask = await SendCommand(alice, HttpMethod.Post, "/api/v1/tasks", 2, foreignBody);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, inactiveTask.StatusCode);
        Assert.Equal("inactive_horse", await ErrorCode(inactiveTask));

        var activeId = await CreateHorse(alice, version: 2);
        using var futureTask = await SendCommand(alice, HttpMethod.Post, "/api/v1/tasks", 3,
            TaskBody(activeId, "2026-09-22"));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, futureTask.StatusCode);
        Assert.Equal("future_task_date", await ErrorCode(futureTask));
    }

    [Fact]
    public async Task Tasks_do_not_freeze_settings_or_change_financial_report_values()
    {
        using var app = new TestApplication();
        using var client = AuthenticatedClient(app, TestIdentityIssuer.Alice);
        using var configured = await SendCommand(client, HttpMethod.Put, "/api/v1/account", 0,
            "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        Assert.Equal(HttpStatusCode.OK, configured.StatusCode);
        var horseId = await CreateHorse(client, version: 1);
        using var firstTask = await SendCommand(client, HttpMethod.Post, "/api/v1/tasks", 2, TaskBody(horseId, "2026-09-20"));
        Assert.Equal(HttpStatusCode.Created, firstTask.StatusCode);

        using var account = await client.GetAsync("/api/v1/account");
        using var accountBody = JsonDocument.Parse(await account.Content.ReadAsStringAsync());
        Assert.False(accountBody.RootElement.GetProperty("settingsLocked").GetBoolean());
        using var settingsChange = await SendCommand(client, HttpMethod.Put, "/api/v1/account", 3,
            "{\"currency\":\"USD\",\"timeZone\":\"America/New_York\"}");
        Assert.Equal(HttpStatusCode.OK, settingsChange.StatusCode);

        using var expense = await SendCommand(client, HttpMethod.Post, "/api/v1/expenses", 4,
            $"{{\"expenseDate\":\"2026-09-20\",\"amountMinor\":100,\"category\":\"Feed\",\"description\":\"hay\",\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{horseId:D}\"]}}}}");
        Assert.Equal(HttpStatusCode.Created, expense.StatusCode);
        using var before = await client.GetAsync("/api/v1/reports/monthly-pnl?month=2026-09");
        using var beforeBody = JsonDocument.Parse(await before.Content.ReadAsStringAsync());

        using var secondTask = await SendCommand(client, HttpMethod.Post, "/api/v1/tasks", 5, TaskBody(horseId, "2026-09-21"));
        Assert.Equal(HttpStatusCode.Created, secondTask.StatusCode);
        using var after = await client.GetAsync("/api/v1/reports/monthly-pnl?month=2026-09");
        using var afterBody = JsonDocument.Parse(await after.Content.ReadAsStringAsync());
        Assert.Equal(beforeBody.RootElement.GetProperty("items").GetRawText(), afterBody.RootElement.GetProperty("items").GetRawText());
    }

    [Fact]
    public async Task Task_requests_require_authentication_and_reject_invalid_effort_and_filters()
    {
        using var app = new TestApplication();
        using var anonymous = app.CreateClient();
        using var unauthorized = await anonymous.GetAsync("/api/v1/tasks?from=2026-09-19&to=2026-09-21");
        Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
        using var unauthorizedReport = await anonymous.GetAsync("/api/v1/reports/activity?from=2026-09-19&to=2026-09-21");
        Assert.Equal(HttpStatusCode.Unauthorized, unauthorizedReport.StatusCode);

        using var client = AuthenticatedClient(app, TestIdentityIssuer.Alice);
        var horseId = await CreateHorse(client);
        using var noEffort = await SendCommand(client, HttpMethod.Post, "/api/v1/tasks", 1,
            TaskBody(horseId, "2026-09-20", "\"minutes\":0"));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, noEffort.StatusCode);
        using var mismatchedUnit = await SendCommand(client, HttpMethod.Post, "/api/v1/tasks", 1,
            TaskBody(horseId, "2026-09-20", "\"minutes\":1,\"quantityUnit\":\"hours\""));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, mismatchedUnit.StatusCode);
        using var invalidType = await client.GetAsync("/api/v1/tasks?from=2026-09-19&to=2026-09-21&taskType=riding");
        Assert.Equal(HttpStatusCode.BadRequest, invalidType.StatusCode);
    }

    private static HttpClient AuthenticatedClient(TestApplication app, string subject)
    {
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", app.Identity.Issue(subject, app.Clock.GetUtcNow()));
        return client;
    }

    private static async Task<Guid> CreateHorse(HttpClient client, long version = 0)
    {
        using var response = await SendCommand(client, HttpMethod.Post, "/api/v1/horses", version,
            "{\"name\":\"Misty\",\"breed\":\"Arabian\",\"dateOfBirth\":null,\"status\":\"Active\"}");
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.GetProperty("horseId").GetGuid();
    }

    private static string TaskBody(Guid horseId, string date, string extra = "\"minutes\":30") =>
        $"{{\"horseId\":\"{horseId:D}\",\"taskDate\":\"{date}\",\"taskType\":\"Riding\",{extra}}}";

    private static Task<HttpResponseMessage> SendCommand(HttpClient client, HttpMethod method, string path, long version, string body)
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
}
