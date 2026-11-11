using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using CostTracking.Api.Storage;
using CostTracking.Tests.Fixtures;
using Microsoft.Extensions.DependencyInjection;

namespace CostTracking.Tests.Integration;

public sealed class FinancialPreviewTests
{
    [Fact]
    public async Task Future_rule_example_previews_are_read_only_and_normal_one_time_previews_stay_date_limited()
    {
        using var app = new TestApplication();
        using var client = Client(app);
        using var account = await Send(client, HttpMethod.Put, "/api/v1/account", 0,
            "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        Assert.Equal(HttpStatusCode.OK, account.StatusCode);
        var horseId = await CreateHorse(client);
        var store = app.Services.GetRequiredService<JsonlEventStore>();
        var originalCount = (await store.ReadAsync(TestIdentityIssuer.Alice)).Count;

        foreach (var kind in new[] { "Expense", "Income" })
        {
            var dateProperty = kind == "Expense" ? "expenseDate" : "receivedDate";
            var financialValues = kind == "Expense"
                ? $"\"category\":\"Feed\",\"description\":\"Hay\",\"{dateProperty}\":\"2026-10-01\",\"amountMinor\":125"
                : $"\"source\":\"Lessons\",\"{dateProperty}\":\"2026-10-01\",\"amountMinor\":125";
            var values = $"{{{financialValues},\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{horseId:D}\"]}}}}";

            using var ordinary = await Preview(client, $"{{\"kind\":\"{kind}\",\"values\":{values}}}");
            Assert.Equal(HttpStatusCode.UnprocessableEntity, ordinary.StatusCode);

            using var example = await Preview(client,
                $"{{\"kind\":\"{kind}\",\"exampleOccurrence\":true,\"values\":{values}}}");
            Assert.Equal(HttpStatusCode.OK, example.StatusCode);
            using var json = JsonDocument.Parse(await example.Content.ReadAsStringAsync());
            Assert.Equal("2026-10-01", json.RootElement.GetProperty("date").GetString());
            Assert.Equal(125, json.RootElement.GetProperty("amountMinor").GetInt64());
            var effect = Assert.Single(json.RootElement.GetProperty("monthlyEffect").EnumerateArray());
            Assert.Equal(kind == "Income" ? 125 : -125, effect.GetProperty("netDeltaMinor").GetInt64());
            Assert.Equal(originalCount, (await store.ReadAsync(TestIdentityIssuer.Alice)).Count);
        }
    }

    [Theory]
    [InlineData("Expense", null, 200)]
    [InlineData("Income", "2031-12-01", 200)]
    [InlineData("Income", "2031-11-30", 422)]
    public async Task Long_interval_examples_search_successive_windows_until_the_inclusive_end(string kind, string? endDate, int status)
    {
        using var app = new TestApplication();
        using var client = Client(app);
        using var account = await Send(client, HttpMethod.Put, "/api/v1/account", 0,
            "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        var horse = await CreateHorse(client);
        var values = new Dictionary<string, object> {
            [kind == "Expense" ? "expenseDate" : "receivedDate"] = "2026-11-11",
            ["amountMinor"] = 125,
            ["split"] = new { mode = "Equal", horseIds = new[] { horse } }
        };
        if (kind == "Expense") { values["category"] = "Feed"; values["description"] = "Hay"; }
        else values["source"] = "Lessons";
        var body = JsonSerializer.Serialize(new {
            kind, exampleOccurrence = true,
            exampleSchedule = new { cadence = "Monthly", interval = 61, weekdays = Array.Empty<int>(), dayOfMonth = 1, startDate = "2026-11-11", endDate },
            values
        });
        using var preview = await Preview(client, body);
        Assert.Equal(status, (int)preview.StatusCode);
        if (status == 200) {
            using var json = JsonDocument.Parse(await preview.Content.ReadAsStringAsync());
            Assert.Equal("2031-12-01", json.RootElement.GetProperty("date").GetString());
        }
    }

    private static HttpClient Client(TestApplication app)
    {
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer",
            app.Identity.Issue(TestIdentityIssuer.Alice, app.Clock.GetUtcNow()));
        return client;
    }

    private static async Task<Guid> CreateHorse(HttpClient client)
    {
        using var response = await Send(client, HttpMethod.Post, "/api/v1/horses", 1,
            "{\"name\":\"Misty\",\"breed\":\"Arabian\",\"dateOfBirth\":null,\"status\":\"Active\"}");
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.GetProperty("horseId").GetGuid();
    }

    private static Task<HttpResponseMessage> Preview(HttpClient client, string body) => client.PostAsync(
        "/api/v1/previews/financial", new StringContent(body, Encoding.UTF8, "application/json"));

    private static Task<HttpResponseMessage> Send(HttpClient client, HttpMethod method, string path,
        long version, string body)
    {
        var request = new HttpRequestMessage(method, path)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json")
        };
        request.Headers.TryAddWithoutValidation("Idempotency-Key", Guid.NewGuid().ToString("D"));
        request.Headers.TryAddWithoutValidation("If-Match", $"\"{version}\"");
        return client.SendAsync(request);
    }
}
