using CostTracking.Api.Auth;

namespace CostTracking.Tests.Fixtures;

public sealed class TestWorkOsClient(TestIdentityIssuer identity, TimeProvider clock) : IWorkOsClient
{
    private int tokenGeneration;
    public string? LastVerifier { get; private set; }
    public int RefreshCount { get; private set; }
    public bool FailRefreshTransiently { get; set; }
    public bool FailRefreshTerminally { get; set; }
    public TimeSpan RefreshDelay { get; set; }
    public string? NextRefreshAccessToken { get; set; }
    public string? NextExchangeAccessToken { get; set; }

    public Task<WorkOsTokens> ExchangeCodeAsync(string code, string verifier, CancellationToken cancellationToken)
    {
        LastVerifier = verifier;
        if (NextExchangeAccessToken is not null) return Task.FromResult(new WorkOsTokens(NextExchangeAccessToken, "refresh_bad", 600));
        return Task.FromResult(CreateTokens());
    }

    public Task<WorkOsTokens> RefreshAsync(string refreshToken, CancellationToken cancellationToken)
    {
        RefreshCount++;
        if (FailRefreshTerminally) throw new WorkOsAuthenticationException(terminal: true);
        if (FailRefreshTransiently) throw new WorkOsAuthenticationException(terminal: false);
        if (NextRefreshAccessToken is not null) return Task.FromResult(new WorkOsTokens(NextRefreshAccessToken, "refresh_bad", 600));
        return RefreshAfterDelayAsync(cancellationToken);
    }

    private async Task<WorkOsTokens> RefreshAfterDelayAsync(CancellationToken cancellationToken)
    {
        if (RefreshDelay > TimeSpan.Zero) await Task.Delay(RefreshDelay, cancellationToken);
        return CreateTokens();
    }

    private WorkOsTokens CreateTokens()
    {
        var generation = Interlocked.Increment(ref tokenGeneration);
        return new WorkOsTokens(identity.Issue(TestIdentityIssuer.Alice, clock.GetUtcNow(), sessionId: "sid_test"),
            $"refresh_{generation}", 600);
    }
}
