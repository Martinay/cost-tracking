using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace CostTracking.Api.Auth;

public sealed record WorkOsTokens(string AccessToken, string RefreshToken, long ExpiresIn);

public interface IWorkOsClient
{
    Task<WorkOsTokens> ExchangeCodeAsync(string code, string verifier, CancellationToken cancellationToken);
    Task<WorkOsTokens> RefreshAsync(string refreshToken, CancellationToken cancellationToken);
}

public sealed class WorkOsClient(HttpClient client, IConfiguration configuration) : IWorkOsClient
{
    private readonly string clientId = Required(configuration["WorkOS:ClientId"], "WorkOS:ClientId");
    private readonly string clientSecret = Required(configuration["WorkOS:ApiKey"], "WorkOS:ApiKey");

    public async Task<WorkOsTokens> ExchangeCodeAsync(string code, string verifier, CancellationToken cancellationToken)
    {
        using var response = await client.PostAsJsonAsync("user_management/authenticate", new
        {
            client_id = clientId, client_secret = clientSecret, grant_type = "authorization_code", code, code_verifier = verifier
        }, cancellationToken);
        return await ReadTokensAsync(response, cancellationToken);
    }

    public async Task<WorkOsTokens> RefreshAsync(string refreshToken, CancellationToken cancellationToken)
    {
        using var response = await client.PostAsJsonAsync("user_management/authenticate", new
        {
            client_id = clientId, client_secret = clientSecret, grant_type = "refresh_token", refresh_token = refreshToken
        }, cancellationToken);
        return await ReadTokensAsync(response, cancellationToken);
    }

    private static async Task<WorkOsTokens> ReadTokensAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (!response.IsSuccessStatusCode)
        {
            var status = (int)response.StatusCode;
            if (status is 400 or 401) throw new WorkOsAuthenticationException(terminal: true);
            throw new WorkOsAuthenticationException(terminal: false);
        }
        TokenResponse? payload;
        try { payload = await response.Content.ReadFromJsonAsync<TokenResponse>(cancellationToken: cancellationToken); }
        catch (System.Text.Json.JsonException) { throw new WorkOsAuthenticationException(terminal: false); }
        if (payload is null) throw new WorkOsAuthenticationException(terminal: false);
        if (string.IsNullOrWhiteSpace(payload.AccessToken) || string.IsNullOrWhiteSpace(payload.RefreshToken) || payload.ExpiresIn <= 0)
            throw new WorkOsAuthenticationException(terminal: false);
        return new WorkOsTokens(payload.AccessToken, payload.RefreshToken, payload.ExpiresIn);
    }

    private static string Required(string? value, string name) =>
        string.IsNullOrWhiteSpace(value) ? throw new InvalidOperationException($"{name} is required.") : value;

    private sealed record TokenResponse([property: JsonPropertyName("access_token")] string AccessToken,
        [property: JsonPropertyName("refresh_token")] string RefreshToken,
        [property: JsonPropertyName("expires_in")] long ExpiresIn);
}

public sealed class WorkOsAuthenticationException(bool terminal) : Exception("Authentication provider request failed.")
{
    public bool Terminal { get; } = terminal;
}
