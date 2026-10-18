using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using CostTracking.Api.Domain;
using CostTracking.Api.Storage;
using CostTracking.Tests.Fixtures;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace CostTracking.Tests.Integration;

public sealed class DrivingTests
{
    [Fact]
    public async Task Rate_changes_are_versioned_and_each_trip_keeps_the_exact_rate_used()
    {
        using var app = new TestApplication();
        using var client = Client(app);
        using var configured = await Send(client, HttpMethod.Put, "/api/v1/account", 0,
            "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        var horseId = await CreateHorse(client, 1);
        using var rate = await Send(client, HttpMethod.Put, "/api/v1/driving-rate", 2, "{\"rateMinorPerKm\":0.5}");
        Assert.Equal(HttpStatusCode.OK, rate.StatusCode);

        var firstBody = $"{{\"expenseDate\":\"2026-09-21\",\"kilometers\":10.25,\"rateMinorPerKm\":50,\"description\":\"Trip one\",\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{horseId:D}\"]}}}}";
        var tripKey = Guid.NewGuid();
        using var first = await Send(client, HttpMethod.Post, "/api/v1/driving", 3, firstBody, tripKey);
        Assert.True(first.StatusCode == HttpStatusCode.Created, await first.Content.ReadAsStringAsync());
        using var firstJson = JsonDocument.Parse(await first.Content.ReadAsStringAsync());
        Assert.Equal(513, firstJson.RootElement.GetProperty("amountMinor").GetInt64());
        Assert.NotNull(first.Headers.ETag);
        using var retry = await Send(client, HttpMethod.Post, "/api/v1/driving", 3, firstBody, tripKey);
        Assert.Equal(HttpStatusCode.Created, retry.StatusCode);
        Assert.Equal(first.Headers.ETag?.Tag, retry.Headers.ETag?.Tag);
        Assert.Equal(await first.Content.ReadAsStringAsync(), await retry.Content.ReadAsStringAsync());

        using var changedRate = await Send(client, HttpMethod.Put, "/api/v1/driving-rate", 4, "{\"rateMinorPerKm\":0.75}");
        Assert.Equal(HttpStatusCode.OK, changedRate.StatusCode);
        var secondBody = $"{{\"expenseDate\":\"2026-09-21\",\"kilometers\":1,\"description\":\"Trip two\",\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{horseId:D}\"]}}}}";
        using var second = await Send(client, HttpMethod.Post, "/api/v1/driving", 5, secondBody);
        Assert.Equal(HttpStatusCode.Created, second.StatusCode);
        using var secondJson = JsonDocument.Parse(await second.Content.ReadAsStringAsync());
        Assert.Equal(1, secondJson.RootElement.GetProperty("amountMinor").GetInt64());

        using var expenseList = await client.GetAsync("/api/v1/expenses?from=2026-09-21&to=2026-09-21");
        Assert.Equal(HttpStatusCode.OK, expenseList.StatusCode);
        using var expenseListJson = JsonDocument.Parse(await expenseList.Content.ReadAsStringAsync());
        var listedFirstTrip = expenseListJson.RootElement.GetProperty("items").EnumerateArray()
            .Single(item => item.GetProperty("description").GetString() == "Trip one");
        Assert.Equal(10.25m, listedFirstTrip.GetProperty("driving").GetProperty("kilometers").GetDecimal());
        Assert.Equal(50m, listedFirstTrip.GetProperty("driving").GetProperty("rateMinorPerKm").GetDecimal());
        var listedSecondTrip = expenseListJson.RootElement.GetProperty("items").EnumerateArray()
            .Single(item => item.GetProperty("description").GetString() == "Trip two");
        Assert.Equal(1m, listedSecondTrip.GetProperty("driving").GetProperty("kilometers").GetDecimal());
        Assert.Equal(0.75m, listedSecondTrip.GetProperty("driving").GetProperty("rateMinorPerKm").GetDecimal());

        var store = app.Services.GetRequiredService<JsonlEventStore>();
        var expenses = ExpenseProjection.Replay(await store.ReadAsync(TestIdentityIssuer.Alice));
        Assert.Equal(new DrivingDetails(10.25m, 50m), expenses.Single(item => item.ExpenseDate == DateOnly.FromDateTime(new DateTime(2026, 9, 21)) && item.Description == "Trip one").Driving);
        Assert.Equal(new DrivingDetails(1m, 0.75m), expenses.Single(item => item.Description == "Trip two").Driving);
        using var account = await client.GetAsync("/api/v1/account");
        using var accountJson = JsonDocument.Parse(await account.Content.ReadAsStringAsync());
        Assert.True(accountJson.RootElement.GetProperty("settingsLocked").GetBoolean());
        using var rateAfterFinancialEntry = await Send(client, HttpMethod.Put, "/api/v1/driving-rate", 6, "{\"rateMinorPerKm\":0.8}");
        Assert.Equal(HttpStatusCode.OK, rateAfterFinancialEntry.StatusCode);
        using var lockedConfiguration = await Send(client, HttpMethod.Put, "/api/v1/account", 7,
            "{\"currency\":\"USD\",\"timeZone\":\"Europe/Berlin\"}");
        Assert.Equal(HttpStatusCode.Conflict, lockedConfiguration.StatusCode);
    }

    [Fact]
    public async Task Changing_currency_before_financial_activity_clears_the_saved_rate()
    {
        using var app = new TestApplication();
        using var client = Client(app);
        _ = await Send(client, HttpMethod.Put, "/api/v1/account", 0, "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        var horseId = await CreateHorse(client, 1);
        using var rate = await Send(client, HttpMethod.Put, "/api/v1/driving-rate", 2, "{\"rateMinorPerKm\":12.5}");
        Assert.Equal(HttpStatusCode.OK, rate.StatusCode);
        using var changedCurrency = await Send(client, HttpMethod.Put, "/api/v1/account", 3,
            "{\"currency\":\"USD\",\"timeZone\":\"Europe/Berlin\"}");
        Assert.Equal(HttpStatusCode.OK, changedCurrency.StatusCode);
        using var account = await client.GetAsync("/api/v1/account");
        using var accountJson = JsonDocument.Parse(await account.Content.ReadAsStringAsync());
        Assert.True(accountJson.RootElement.GetProperty("drivingRateMinorPerKm").ValueKind == JsonValueKind.Null);
        var body = $"{{\"expenseDate\":\"2026-09-21\",\"kilometers\":1,\"description\":\"Trip\",\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{horseId:D}\"]}}}}";
        using var noStaleRate = await Send(client, HttpMethod.Post, "/api/v1/driving", 4, body);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, noStaleRate.StatusCode);
        Assert.Equal("driving_rate_required", await ErrorCode(noStaleRate));
    }

    [Fact]
    public async Task Malformed_payloads_and_ineligible_or_unknown_split_targets_do_not_commit()
    {
        using var app = new TestApplication();
        using var client = Client(app);
        _ = await Send(client, HttpMethod.Put, "/api/v1/account", 0, "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        var horseId = await CreateHorse(client, 1);
        using var rate = await Send(client, HttpMethod.Put, "/api/v1/driving-rate", 2, "{\"rateMinorPerKm\":10}");
        Assert.Equal(HttpStatusCode.OK, rate.StatusCode);
        var body = $"{{\"expenseDate\":\"2026-09-21\",\"kilometers\":1,\"description\":\"Trip\",\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{horseId:D}\"]}}}}";
        using var duplicateProperty = await Send(client, HttpMethod.Post, "/api/v1/driving", 3,
            body.Replace("\"kilometers\":1", "\"kilometers\":1,\"kilometers\":2", StringComparison.Ordinal));
        Assert.Equal(HttpStatusCode.BadRequest, duplicateProperty.StatusCode);
        var unknownBody = body.Replace(horseId.ToString("D"), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", StringComparison.Ordinal);
        using var unknownHorse = await Send(client, HttpMethod.Post, "/api/v1/driving", 3, unknownBody);
        Assert.Equal(HttpStatusCode.NotFound, unknownHorse.StatusCode);
        using var sold = await Send(client, HttpMethod.Put, $"/api/v1/horses/{horseId:D}/status", 3, "{\"status\":\"Sold\"}");
        Assert.Equal(HttpStatusCode.OK, sold.StatusCode);
        using var inactiveHorse = await Send(client, HttpMethod.Post, "/api/v1/driving", 4, body);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, inactiveHorse.StatusCode);
        Assert.Equal("inactive_horse", await ErrorCode(inactiveHorse));
        using var account = await client.GetAsync("/api/v1/account");
        using var accountJson = JsonDocument.Parse(await account.Content.ReadAsStringAsync());
        Assert.False(accountJson.RootElement.GetProperty("settingsLocked").GetBoolean());
        Assert.Equal(4, accountJson.RootElement.GetProperty("streamVersion").GetInt64());
    }

    [Fact]
    public async Task Missing_rate_invalid_trip_and_future_date_are_rejected_without_financial_commit()
    {
        using var app = new TestApplication();
        using var client = Client(app);
        _ = await Send(client, HttpMethod.Put, "/api/v1/account", 0, "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        var horseId = await CreateHorse(client, 1);
        var omittedRate = $"{{\"expenseDate\":\"2026-09-21\",\"kilometers\":1,\"description\":\"Trip\",\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{horseId:D}\"]}}}}";
        using var missing = await Send(client, HttpMethod.Post, "/api/v1/driving", 2, omittedRate);
        Assert.True(missing.StatusCode == HttpStatusCode.UnprocessableEntity, await missing.Content.ReadAsStringAsync());
        Assert.Equal("driving_rate_required", await ErrorCode(missing));

        using var zero = await Send(client, HttpMethod.Post, "/api/v1/driving", 2,
            omittedRate.Replace("\"kilometers\":1", "\"kilometers\":0,\"rateMinorPerKm\":1", StringComparison.Ordinal));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, zero.StatusCode);
        using var future = await Send(client, HttpMethod.Post, "/api/v1/driving", 2,
            omittedRate.Replace("2026-09-21", "2026-09-22", StringComparison.Ordinal).Replace("\"kilometers\":1", "\"kilometers\":1,\"rateMinorPerKm\":1", StringComparison.Ordinal));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, future.StatusCode);
        Assert.Equal("future_financial_date", await ErrorCode(future));
        using var imprecise = await Send(client, HttpMethod.Post, "/api/v1/driving", 2,
            omittedRate.Replace("\"kilometers\":1", "\"kilometers\":1,\"rateMinorPerKm\":0.00001", StringComparison.Ordinal));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, imprecise.StatusCode);
        using var roundedZero = await Send(client, HttpMethod.Post, "/api/v1/driving", 2,
            omittedRate.Replace("\"kilometers\":1", "\"kilometers\":0.001,\"rateMinorPerKm\":0.1", StringComparison.Ordinal));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, roundedZero.StatusCode);

        using var account = await client.GetAsync("/api/v1/account");
        using var accountJson = JsonDocument.Parse(await account.Content.ReadAsStringAsync());
        Assert.False(accountJson.RootElement.GetProperty("settingsLocked").GetBoolean());
        Assert.Equal(2, accountJson.RootElement.GetProperty("streamVersion").GetInt64());
    }

    private static HttpClient Client(TestApplication app)
    {
        var client = app.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", app.Identity.Issue(TestIdentityIssuer.Alice, app.Clock.GetUtcNow()));
        return client;
    }

    private static async Task<Guid> CreateHorse(HttpClient client, long version)
    {
        using var response = await Send(client, HttpMethod.Post, "/api/v1/horses", version,
            "{\"name\":\"Misty\",\"breed\":\"Arabian\",\"dateOfBirth\":null,\"status\":\"Active\"}");
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.GetProperty("horseId").GetGuid();
    }

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
