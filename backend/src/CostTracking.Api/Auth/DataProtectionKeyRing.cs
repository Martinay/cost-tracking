using Azure.Identity;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace CostTracking.Api.Auth;

/// <summary>Configures the shared Data Protection key ring and its at-rest encryptor.</summary>
public static class DataProtectionKeyRing
{
    private static readonly string[] KeyVaultHostSuffixes =
    [
        ".vault.azure.net",
        ".vault.usgovcloudapi.net",
        ".vault.azure.cn",
        ".vault.microsoftazure.de"
    ];

    public static IDataProtectionBuilder Configure(IServiceCollection services, IConfiguration configuration,
        bool isProduction, string keyRingPath)
    {
        var keyIdentifierSetting = configuration["Auth:DataProtectionKeyIdentifier"];
        Uri? keyIdentifier = null;
        if (string.IsNullOrWhiteSpace(keyIdentifierSetting))
        {
            if (isProduction)
                throw new InvalidOperationException("Production requires Auth:DataProtectionKeyIdentifier for Azure Key Vault protection.");
        }
        else
        {
            keyIdentifier = ParseKeyIdentifier(keyIdentifierSetting);
        }

        var builder = services.AddDataProtection()
            .SetApplicationName("CostTracking")
            .PersistKeysToFileSystem(new DirectoryInfo(keyRingPath));

        if (keyIdentifier is not null)
        {
            // Production runs with the app's system-assigned identity. In a local environment,
            // DefaultAzureCredential permits an explicitly configured developer vault.
            if (isProduction)
                builder.ProtectKeysWithAzureKeyVault(keyIdentifier,
                    new ManagedIdentityCredential(ManagedIdentityId.SystemAssigned));
            else
                builder.ProtectKeysWithAzureKeyVault(keyIdentifier, new DefaultAzureCredential());
        }

        return builder;
    }

    public static Uri ParseKeyIdentifier(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var keyIdentifier) ||
            keyIdentifier.Scheme != Uri.UriSchemeHttps ||
            string.IsNullOrWhiteSpace(keyIdentifier.Host) ||
            !KeyVaultHostSuffixes.Any(suffix => keyIdentifier.IdnHost.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)) ||
            !string.IsNullOrEmpty(keyIdentifier.UserInfo) ||
            !keyIdentifier.IsDefaultPort ||
            !string.IsNullOrEmpty(keyIdentifier.Query) ||
            !string.IsNullOrEmpty(keyIdentifier.Fragment))
            throw new InvalidOperationException("Auth:DataProtectionKeyIdentifier must be a versionless HTTPS Azure Key Vault key URI.");

        var segments = keyIdentifier.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length != 2 || !string.Equals(segments[0], "keys", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Auth:DataProtectionKeyIdentifier must identify a versionless Key Vault key at /keys/{name}.");

        return keyIdentifier;
    }
}
