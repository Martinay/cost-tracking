using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using CostTracking.Tests.Fixtures;
using Microsoft.AspNetCore.Mvc.Testing;

namespace CostTracking.Tests.Integration;

public sealed class HistoryTests
{
    [Fact]
    public async Task History_is_chronological_paged_and_excludes_storage_and_auth_metadata()
    {
        using var app = new TestApplication();
        using var client = AuthenticatedClient(app, TestIdentityIssuer.Alice);
        using var account = await Command(client, HttpMethod.Put, "/api/v1/account", 0,
            "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        using var horseCreated = await Command(client, HttpMethod.Post, "/api/v1/horses", 1,
            "{\"name\":\"Misty\",\"breed\":\"Arabian\",\"dateOfBirth\":\"2018-05-01\",\"status\":\"Active\"}");
        using var createdBody = JsonDocument.Parse(await horseCreated.Content.ReadAsStringAsync());
        var horseId = createdBody.RootElement.GetProperty("horseId").GetGuid();
        using var details = await Command(client, HttpMethod.Patch, $"/api/v1/horses/{horseId:D}", 2,
            "{\"name\":\"Misty Blue\"}");
        using var status = await Command(client, HttpMethod.Put, $"/api/v1/horses/{horseId:D}/status", 3,
            "{\"status\":\"Leased\"}");

        using var first = await client.GetAsync("/api/v1/history?limit=2");

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal("\"4\"", first.Headers.ETag?.ToString());
        using var firstBody = JsonDocument.Parse(await first.Content.ReadAsStringAsync());
        var firstItems = firstBody.RootElement.GetProperty("items").EnumerateArray().ToArray();
        Assert.Equal(new long[] { 1, 2 }, firstItems.Select(item => item.GetProperty("streamVersion").GetInt64()));
        Assert.Equal("AccountConfigured", firstItems[0].GetProperty("type").GetString());
        Assert.Equal("Account settings updated", firstItems[0].GetProperty("summary").GetString());
        Assert.Equal("HorseRegistered", firstItems[1].GetProperty("type").GetString());
        var cursor = firstBody.RootElement.GetProperty("nextCursor").GetString();
        Assert.NotNull(cursor);
        var changes = firstItems[1].GetProperty("changes");
        Assert.Equal("Misty", changes.GetProperty("name").GetString());
        foreach (var item in firstItems)
        {
            var raw = item.GetRawText();
            Assert.DoesNotContain("subject", raw, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("commandHash", raw, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("idempotencyKey", raw, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("accessToken", raw, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("/data/", raw, StringComparison.Ordinal);
            Assert.False(item.TryGetProperty("subject", out _));
            Assert.False(item.TryGetProperty("commandHash", out _));
            Assert.False(item.TryGetProperty("idempotencyKey", out _));
        }

        using var second = await client.GetAsync("/api/v1/history?limit=2&cursor=" + Uri.EscapeDataString(cursor!));
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        using var secondBody = JsonDocument.Parse(await second.Content.ReadAsStringAsync());
        var secondItems = secondBody.RootElement.GetProperty("items").EnumerateArray().ToArray();
        Assert.Equal(new long[] { 3, 4 }, secondItems.Select(item => item.GetProperty("streamVersion").GetInt64()));
        Assert.Null(secondBody.RootElement.GetProperty("nextCursor").GetString());
        Assert.Equal("Horse details updated", secondItems[0].GetProperty("summary").GetString());
        Assert.Equal("Horse status changed", secondItems[1].GetProperty("summary").GetString());
    }

    [Fact]
    public async Task Horse_history_filter_is_owner_scoped_and_cursor_binds_filter_and_version()
    {
        using var app = new TestApplication();
        using var alice = AuthenticatedClient(app, TestIdentityIssuer.Alice);
        using var bob = AuthenticatedClient(app, TestIdentityIssuer.Bob);
        using var first = await Command(alice, HttpMethod.Post, "/api/v1/horses", 0,
            "{\"name\":\"Misty\",\"breed\":\"Arabian\",\"dateOfBirth\":null,\"status\":\"Active\"}");
        using var firstJson = JsonDocument.Parse(await first.Content.ReadAsStringAsync());
        var horseId = firstJson.RootElement.GetProperty("horseId").GetGuid();
        using var change = await Command(alice, HttpMethod.Put, $"/api/v1/horses/{horseId:D}/status", 1, "{\"status\":\"Leased\"}");
        using var filtered = await alice.GetAsync($"/api/v1/history?limit=1&horseId={horseId:D}");
        Assert.Equal(HttpStatusCode.OK, filtered.StatusCode);
        using var filteredBody = JsonDocument.Parse(await filtered.Content.ReadAsStringAsync());
        var cursor = filteredBody.RootElement.GetProperty("nextCursor").GetString();
        Assert.NotNull(cursor);

        using var otherFilter = await alice.GetAsync("/api/v1/history?limit=1&ruleId=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb&cursor=" + Uri.EscapeDataString(cursor!));
        Assert.Equal(HttpStatusCode.BadRequest, otherFilter.StatusCode);
        using var foreign = await bob.GetAsync($"/api/v1/history?horseId={horseId:D}");
        using var absent = await bob.GetAsync("/api/v1/history?horseId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
        Assert.Equal(HttpStatusCode.NotFound, foreign.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, absent.StatusCode);
        using var foreignBody = JsonDocument.Parse(await foreign.Content.ReadAsStringAsync());
        using var absentBody = JsonDocument.Parse(await absent.Content.ReadAsStringAsync());
        Assert.Equal(foreignBody.RootElement.GetProperty("code").GetString(), absentBody.RootElement.GetProperty("code").GetString());
        Assert.Equal(foreignBody.RootElement.GetProperty("message").GetString(), absentBody.RootElement.GetProperty("message").GetString());

        using var append = await Command(alice, HttpMethod.Put, "/api/v1/account", 2,
            "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        using var stale = await alice.GetAsync($"/api/v1/history?limit=1&horseId={horseId:D}&cursor=" + Uri.EscapeDataString(cursor!));
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
    }

    [Fact]
    public async Task Task_history_shows_safe_activity_fields_without_storage_metadata()
    {
        using var app = new TestApplication();
        using var client = AuthenticatedClient(app, TestIdentityIssuer.Alice);
        using var horse = await Command(client, HttpMethod.Post, "/api/v1/horses", 0,
            "{\"name\":\"Misty\",\"breed\":\"Arabian\",\"dateOfBirth\":null,\"status\":\"Active\"}");
        using var horseJson = JsonDocument.Parse(await horse.Content.ReadAsStringAsync());
        var horseId = horseJson.RootElement.GetProperty("horseId").GetGuid();
        using var task = await Command(client, HttpMethod.Post, "/api/v1/tasks", 1,
            $"{{\"horseId\":\"{horseId:D}\",\"taskDate\":\"2026-09-20\",\"taskType\":\"Riding\",\"minutes\":45,\"notes\":\"Hill work\"}}");
        Assert.Equal(HttpStatusCode.Created, task.StatusCode);

        using var response = await client.GetAsync($"/api/v1/history?horseId={horseId:D}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var activity = Assert.Single(body.RootElement.GetProperty("items").EnumerateArray(), item => item.GetProperty("type").GetString() == "TaskLogged");
        Assert.Equal("Task recorded", activity.GetProperty("summary").GetString());
        var changes = activity.GetProperty("changes");
        Assert.Equal(horseId, changes.GetProperty("horseId").GetGuid());
        Assert.Equal("Riding", changes.GetProperty("taskType").GetString());
        Assert.Equal(45, changes.GetProperty("minutes").GetInt64());
        Assert.Equal("Hill work", changes.GetProperty("notes").GetString());
        Assert.False(changes.TryGetProperty("commandHash", out _));
        Assert.False(changes.TryGetProperty("subject", out _));
    }

    [Fact]
    public async Task Recurring_rule_and_override_history_use_safe_summaries()
    {
        using var app = new TestApplication();
        using var client = AuthenticatedClient(app, TestIdentityIssuer.Alice);
        _ = await Command(client, HttpMethod.Put, "/api/v1/account", 0,
            "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        using var horse = await Command(client, HttpMethod.Post, "/api/v1/horses", 1,
            "{\"name\":\"Misty\",\"breed\":\"Arabian\",\"dateOfBirth\":null,\"status\":\"Active\"}");
        using var horseJson = JsonDocument.Parse(await horse.Content.ReadAsStringAsync());
        var horseId = horseJson.RootElement.GetProperty("horseId").GetGuid();
        var rule = $"{{\"schedule\":{{\"cadence\":\"Daily\",\"interval\":1,\"weekdays\":[],\"dayOfMonth\":null,\"startDate\":\"2026-09-20\",\"endDate\":\"2026-09-22\"}},\"amountMinor\":100,\"category\":\"Feed\",\"description\":\"Hay\",\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{horseId:D}\"]}}}}";
        using var created = await Command(client, HttpMethod.Post, "/api/v1/expense-rules", 2, rule);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var ruleJson = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var ruleId = ruleJson.RootElement.GetProperty("ruleId").GetGuid();
        using var skipped = await Command(client, HttpMethod.Put,
            $"/api/v1/expense-rules/{ruleId:D}/occurrences/2026-09-21", 3,
            "{\"action\":\"Skipped\",\"changed\":null}");
        Assert.Equal(HttpStatusCode.OK, skipped.StatusCode);

        using var response = await client.GetAsync($"/api/v1/history?ruleId={ruleId:D}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var rows = body.RootElement.GetProperty("items").EnumerateArray().ToArray();
        Assert.Equal(new[] { "RecurringExpenseRuleCreated", "RecurringExpenseOccurrenceOverridden" },
            rows.Select(item => item.GetProperty("type").GetString()));
        Assert.All(rows, item => Assert.DoesNotContain("commandHash", item.GetRawText(), StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Recurring_income_rule_and_final_decision_have_safe_history_summaries()
    {
        using var app = new TestApplication();
        using var client = AuthenticatedClient(app, TestIdentityIssuer.Alice);
        _ = await Command(client, HttpMethod.Put, "/api/v1/account", 0,
            "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        using var horse = await Command(client, HttpMethod.Post, "/api/v1/horses", 1,
            "{\"name\":\"Misty\",\"breed\":\"Arabian\",\"dateOfBirth\":null,\"status\":\"Active\"}");
        using var horseJson = JsonDocument.Parse(await horse.Content.ReadAsStringAsync());
        var horseId = horseJson.RootElement.GetProperty("horseId").GetGuid();
        var rule = $"{{\"schedule\":{{\"cadence\":\"Daily\",\"interval\":1,\"weekdays\":[],\"dayOfMonth\":null,\"startDate\":\"2026-09-01\",\"endDate\":null}},\"amountMinor\":100,\"source\":\"Lessons\",\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{horseId:D}\"]}}}}";
        using var created = await Command(client, HttpMethod.Post, "/api/v1/income-rules", 2, rule);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var ruleJson = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var ruleId = ruleJson.RootElement.GetProperty("ruleId").GetGuid();
        using var approved = await Command(client, HttpMethod.Post,
            $"/api/v1/income-rules/{ruleId:D}/occurrences/2026-09-20/approve", 3,
            $"{{\"receivedDate\":\"2026-09-20\",\"amountMinor\":100,\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{horseId:D}\"]}}}}");
        Assert.Equal(HttpStatusCode.OK, approved.StatusCode);

        using var response = await client.GetAsync($"/api/v1/history?ruleId={ruleId:D}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var rows = body.RootElement.GetProperty("items").EnumerateArray().ToArray();
        Assert.Equal(new[] { "RecurringIncomeRuleCreated", "RecurringIncomeApproved" },
            rows.Select(item => item.GetProperty("type").GetString()));
        Assert.Contains("income-rule/", rows[1].GetProperty("changes").GetRawText(), StringComparison.OrdinalIgnoreCase);
        Assert.All(rows, item => Assert.DoesNotContain("commandHash", item.GetRawText(), StringComparison.OrdinalIgnoreCase));
    }

    private static HttpClient AuthenticatedClient(TestApplication app, string subject)
    {
        var client = app.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", app.Identity.Issue(subject, app.Clock.GetUtcNow()));
        return client;
    }

    private static Task<HttpResponseMessage> Command(HttpClient client, HttpMethod method, string path, long version, string body)
    {
        var request = new HttpRequestMessage(method, path) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        request.Headers.TryAddWithoutValidation("Idempotency-Key", Guid.NewGuid().ToString("D"));
        request.Headers.TryAddWithoutValidation("If-Match", $"\"{version}\"");
        return client.SendAsync(request);
    }
}
