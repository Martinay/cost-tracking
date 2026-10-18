using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using CostTracking.Api.Storage;
using CostTracking.Api.Auth;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.AspNetCore.DataProtection;

namespace CostTracking.Tests.Fixtures;

public sealed class TestApplication : WebApplicationFactory<Program>
{
    private readonly bool deleteStorageRootOnDispose;
    private readonly string frontendOrigin;
    private readonly Func<Guid> idFactory;
    private readonly int rateLimitPermitLimit;
    public string StorageRoot { get; }
    public TestIdentityIssuer Identity { get; }
    public FixedClock Clock { get; } = new(new DateTimeOffset(2026, 9, 21, 12, 0, 0, TimeSpan.Zero));
    public TestWorkOsClient WorkOs { get; private set; } = null!;
    private long nextId;

    public TestApplication(string? storageRoot = null, bool deleteStorageRootOnDispose = true,
        string frontendOrigin = "https://app.test", TestIdentityIssuer? identity = null, Func<Guid>? idFactory = null,
        int rateLimitPermitLimit = 120)
    {
        if (rateLimitPermitLimit < 1) throw new ArgumentOutOfRangeException(nameof(rateLimitPermitLimit));
        this.rateLimitPermitLimit = rateLimitPermitLimit;
        StorageRoot = storageRoot ?? Path.Combine(Path.GetTempPath(), "cost-tracking-tests", Guid.NewGuid().ToString("N"));
        this.deleteStorageRootOnDispose = deleteStorageRootOnDispose;
        this.frontendOrigin = frontendOrigin;
        Identity = identity ?? new TestIdentityIssuer();
        this.idFactory = idFactory ?? (() => Guid.Parse($"00000000-0000-4000-8000-{Interlocked.Increment(ref nextId):D12}"));
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseContentRoot(Path.GetFullPath("../../../../../src/CostTracking.Api", AppContext.BaseDirectory));
        builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Storage:Root"] = StorageRoot,
            ["Auth:Issuer"] = TestIdentityIssuer.Issuer,
            ["Auth:Audience"] = TestIdentityIssuer.Audience,
            ["Auth:JwksUrl"] = "https://issuer.test/jwks",
            ["Auth:FrontendOrigin"] = frontendOrigin,
            ["Auth:CallbackUrl"] = "https://api.test/auth/callback",
            ["Cors:AllowedOrigin"] = frontendOrigin,
            ["WorkOS:ClientId"] = "client_test",
            ["WorkOS:ApiKey"] = "sk_test_dummy",
            ["RateLimit:PermitLimit"] = rateLimitPermitLimit.ToString(System.Globalization.CultureInfo.InvariantCulture)
        }));
        builder.ConfigureTestServices(services =>
        {
            services.AddDataProtection().SetApplicationName("CostTracking")
                .PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(StorageRoot, "auth", "keys")));
            services.RemoveAll<SubjectLock>();
            services.AddSingleton(new SubjectLock((_, _) => 0));
            WorkOs = new TestWorkOsClient(Identity, Clock);
            services.RemoveAll<IWorkOsClient>();
            services.AddSingleton<IWorkOsClient>(WorkOs);
            var manager = new StaticJwksConfigurationManager(Identity.Key);
            services.AddSingleton<IConfigurationManager<OpenIdConnectConfiguration>>(manager);
            services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
            {
                options.ConfigurationManager = manager;
                options.RefreshOnIssuerKeyNotFound = false;
            });
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(Clock);
            services.RemoveAll<Func<Guid>>();
            services.AddSingleton(idFactory);
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (!disposing) return;
        if (Identity is not null) Identity.Dispose();
        if (deleteStorageRootOnDispose && Directory.Exists(StorageRoot)) Directory.Delete(StorageRoot, true);
    }
}

public sealed class FixedClock(DateTimeOffset now) : TimeProvider
{
    private DateTimeOffset current = now;
    public override DateTimeOffset GetUtcNow() => current;
    public void Advance(TimeSpan duration) => current = current.Add(duration);
}
