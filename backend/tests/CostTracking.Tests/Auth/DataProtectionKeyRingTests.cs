using CostTracking.Api.Auth;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace CostTracking.Tests.Auth;

public sealed class DataProtectionKeyRingTests
{
    [Fact]
    public void Production_requires_a_key_vault_key_identifier()
    {
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder().Build();

        var error = Assert.Throws<InvalidOperationException>(() =>
        {
            DataProtectionKeyRing.Configure(services, configuration, isProduction: true, "/tmp/cost-tracking-keys");
        });

        Assert.Contains("Auth:DataProtectionKeyIdentifier", error.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("http://vault.vault.azure.net/keys/protection")]
    [InlineData("https://vault.vault.azure.net/keys/protection/version")]
    [InlineData("https://vault.vault.azure.net/secrets/protection")]
    [InlineData("https://vault.vault.azure.net/keys/protection?version=old")]
    [InlineData("https://example.test/keys/protection")]
    public void Production_rejects_key_identifiers_that_are_not_versionless_https_key_uris(string value)
    {
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Auth:DataProtectionKeyIdentifier"] = value
        }).Build();

        Assert.Throws<InvalidOperationException>(() =>
        {
            DataProtectionKeyRing.Configure(services, configuration, isProduction: true, "/tmp/cost-tracking-keys");
        });
    }

    [Fact]
    public void Local_configuration_keeps_the_filesystem_key_ring_without_azure_credentials()
    {
        var root = Path.Combine(Path.GetTempPath(), "cost-tracking-dp-local", Guid.NewGuid().ToString("N"));
        var keyPath = Path.Combine(root, "auth", "keys");
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder().Build();
        try
        {
            DataProtectionKeyRing.Configure(services, configuration, isProduction: false, keyPath);
            using var provider = services.BuildServiceProvider();
            var protector = provider.GetRequiredService<IDataProtectionProvider>().CreateProtector("local-test");

            Assert.Equal("local payload", protector.Unprotect(protector.Protect("local payload")));
            var keyFile = Assert.Single(Directory.GetFiles(keyPath, "*.xml"));
            Assert.DoesNotContain("Azure Key Vault", File.ReadAllText(keyFile), StringComparison.Ordinal);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }
}
