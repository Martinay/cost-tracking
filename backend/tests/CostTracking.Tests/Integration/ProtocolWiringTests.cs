using System.Net;
using System.Text.Json;
using CostTracking.Tests.Fixtures;

namespace CostTracking.Tests.Integration;

public class ProtocolWiringTests
{
    [Fact]
    public async Task Real_host_rejects_unauthenticated_domain_access_with_safe_cors_error()
    {
        using var host = new TestApplication();
        using var client = host.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/not-yet-implemented");
        request.Headers.Add("Origin", "https://app.test");
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        using var error = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("unauthenticated", error.RootElement.GetProperty("code").GetString());
        Assert.Equal("https://app.test", response.Headers.GetValues("Access-Control-Allow-Origin").Single());
        Assert.False(Directory.Exists(Path.Combine(host.StorageRoot, "users")));
    }
}
