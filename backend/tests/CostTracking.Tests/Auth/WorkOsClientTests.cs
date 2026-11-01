using System.Net;
using System.Text;
using CostTracking.Api.Auth;
using Microsoft.Extensions.Configuration;

namespace CostTracking.Tests.Auth;

public sealed class WorkOsClientTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Authentication_accepts_AuthKit_response_without_expires_in(bool refresh)
    {
        using var http = CreateHttpClient("""
            {"user":{"id":"user_test"},"access_token":"access-token","refresh_token":"refresh-token"}
            """);
        var client = CreateClient(http);

        var tokens = refresh
            ? await client.RefreshAsync("previous-refresh-token", CancellationToken.None)
            : await client.ExchangeCodeAsync("authorization-code", "verifier", CancellationToken.None);

        Assert.Equal("access-token", tokens.AccessToken);
        Assert.Equal("refresh-token", tokens.RefreshToken);
    }

    [Theory]
    [InlineData(false, "{\"refresh_token\":\"refresh-token\"}")]
    [InlineData(true, "{\"refresh_token\":\"refresh-token\"}")]
    [InlineData(false, "{\"access_token\":\"access-token\"}")]
    [InlineData(true, "{\"access_token\":\"access-token\"}")]
    [InlineData(false, "{\"access_token\":\" \",\"refresh_token\":\"refresh-token\"}")]
    [InlineData(true, "{\"access_token\":\"access-token\",\"refresh_token\":\" \"}")]
    public async Task Authentication_still_rejects_missing_or_blank_tokens(bool refresh, string json)
    {
        using var http = CreateHttpClient(json);
        var client = CreateClient(http);

        var exception = await Assert.ThrowsAsync<WorkOsAuthenticationException>(() => refresh
            ? client.RefreshAsync("previous-refresh-token", CancellationToken.None)
            : client.ExchangeCodeAsync("authorization-code", "verifier", CancellationToken.None));

        Assert.False(exception.Terminal);
    }

    private static HttpClient CreateHttpClient(string json) => new(new ResponseHandler(json))
    {
        BaseAddress = new Uri("https://api.workos.com/")
    };

    private static WorkOsClient CreateClient(HttpClient http) => new(http,
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["WorkOS:ClientId"] = "client_test",
            ["WorkOS:ApiKey"] = "test-key"
        }).Build());

    private sealed class ResponseHandler(string json) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            });
    }
}
