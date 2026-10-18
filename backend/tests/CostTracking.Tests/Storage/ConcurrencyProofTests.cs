using System.Text.Json;
using CostTracking.Api.Auth;
using CostTracking.Api.Storage;

namespace CostTracking.Tests.Storage;

public sealed class ConcurrencyProofTests
{
    [Fact]
    [Trait("Category", "StorageProof")]
    public void Linux_process_proof_report_records_all_local_integrity_cases_and_external_gate()
    {
        if (!OperatingSystem.IsLinux())
        {
            Console.WriteLine("UNPROVEN: the local native flock proof requires Linux; run scripts/verify-storage.sh in the Linux container runtime.");
            return;
        }
        var reportPath = Environment.GetEnvironmentVariable("STORAGE_PROOF_REPORT_PATH");
        if (string.IsNullOrWhiteSpace(reportPath) || !File.Exists(reportPath))
        {
            Console.WriteLine("UNPROVEN: no storage proof report was supplied; run scripts/verify-storage.sh.");
            return;
        }

        var report = File.ReadAllText(reportPath);
        Assert.Contains("Two-process first creation and same-version race | PASS", report, StringComparison.Ordinal);
        Assert.Contains("Two-process idempotency race | PASS", report, StringComparison.Ordinal);
        Assert.Contains("Cross-process freshness and durable append | PASS", report, StringComparison.Ordinal);
        Assert.Contains("Partial-tail recovery | PASS", report, StringComparison.Ordinal);
        Assert.Contains("Unsupported lock | PASS", report, StringComparison.Ordinal);
        Assert.Contains("Independent process lock holder timeout | PASS", report, StringComparison.Ordinal);
        Assert.Contains("Encrypted session storage with native Linux flock | PASS", report, StringComparison.Ordinal);
        Assert.Contains("Azure target-share proof: UNPROVEN", report, StringComparison.Ordinal);
    }

    [Fact]
    [Trait("Category", "AzureSmb")]
    public async Task Independently_mounted_SMB_clients_record_same_version_idempotency_and_freshness_proof()
    {
        if (!OperatingSystem.IsLinux())
        {
            Console.WriteLine("UNPROVEN: AzureSmb proof requires Linux containers with the designated share mounted.");
            return;
        }

        var mountPath = Environment.GetEnvironmentVariable("STORAGE_PROOF_AZURE_MOUNT");
        var reportPath = Environment.GetEnvironmentVariable("STORAGE_PROOF_AZURE_REPORT");
        var runDirectory = Environment.GetEnvironmentVariable("STORAGE_PROOF_AZURE_RUN_DIRECTORY");
        var versionRoot = Environment.GetEnvironmentVariable("STORAGE_PROOF_AZURE_VERSION_ROOT");
        var idempotencyRoot = Environment.GetEnvironmentVariable("STORAGE_PROOF_AZURE_IDEMPOTENCY_ROOT");
        var runId = Environment.GetEnvironmentVariable("STORAGE_PROOF_RUN_ID");
        if (new[] { mountPath, reportPath, runDirectory, versionRoot, idempotencyRoot, runId,
                Environment.GetEnvironmentVariable("STORAGE_PROOF_SHARE_SKU"),
                Environment.GetEnvironmentVariable("STORAGE_PROOF_BILLING_MODEL") }
            .Any(string.IsNullOrWhiteSpace))
        {
            Console.WriteLine("UNPROVEN: no designated Azure SMB share, mount metadata, and two-client run evidence were supplied.");
            return;
        }

        Assert.True(Directory.Exists(mountPath), "The configured Azure share mount must exist.");
        var mountRecord = FindMount(mountPath!);
        Assert.NotNull(mountRecord);
        var fields = mountRecord!.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        Assert.True(fields.Length >= 4, "The share mount must expose a complete /proc/mounts record.");
        Assert.Equal("cifs", fields[2]);
        var options = fields[3].Split(',', StringSplitOptions.RemoveEmptyEntries);
        Assert.DoesNotContain(options, option => option.Equals("nobrl", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(options, option => option.Equals("nostrictsync", StringComparison.OrdinalIgnoreCase));

        var versionA = await ReadOutcome(Path.Combine(runDirectory!, "version-result-a.json"));
        var versionB = await ReadOutcome(Path.Combine(runDirectory!, "version-result-b.json"));
        Assert.Equal(1, new[] { versionA, versionB }.Count(result => result.Status == "committed" && result.Version == 1));
        Assert.Equal(1, new[] { versionA, versionB }.Count(result => result.Status == "version_conflict" && result.Version == 1));

        var sameKeyA = await ReadOutcome(Path.Combine(runDirectory!, "same-key-result-a.json"));
        var sameKeyB = await ReadOutcome(Path.Combine(runDirectory!, "same-key-result-b.json"));
        Assert.All(new[] { sameKeyA, sameKeyB }, result =>
        {
            Assert.Equal("committed", result.Status);
            Assert.Equal(1, result.Version);
        });

        var versionStore = new JsonlEventStore(versionRoot!, new SubjectLock());
        var versionEvents = await versionStore.ReadAsync("user_StorageRace");
        Assert.Single(versionEvents);
        Assert.Equal(1, versionEvents[0].StreamVersion);
        AssertCompleteLine(versionStore.PathFor("user_StorageRace"));

        var sameKeyStore = new JsonlEventStore(idempotencyRoot!, new SubjectLock());
        var sameKeyEvents = await sameKeyStore.ReadAsync("user_StorageIdempotency");
        Assert.Single(sameKeyEvents);
        Assert.Equal(1, sameKeyEvents[0].StreamVersion);
        AssertCompleteLine(sameKeyStore.PathFor("user_StorageIdempotency"));
        await AssertChangedBodyConflicts(sameKeyStore);

        var redactedOptions = string.Join(',', options.Select(RedactMountOption));
        var dialect = options.FirstOrDefault(option => option.StartsWith("vers=", StringComparison.OrdinalIgnoreCase)) ?? "unreported";
        var kernel = File.Exists("/proc/version") ? File.ReadAllText("/proc/version").Trim() : "unavailable";
        var image = Environment.GetEnvironmentVariable("STORAGE_PROOF_IMAGE_DIGEST") ?? "unreported";
        var report = File.ReadAllText(reportPath!);
        var unproven = "- Azure target-share proof: UNPROVEN (no designated share configuration or mount was supplied).";
        Assert.Contains(unproven, report, StringComparison.Ordinal);
        var proofLine = "- Azure target-share proof: PASS for the designated synthetic share; this does not establish network-interruption, failover, backup/restore, or release readiness.";
        report = report.Replace(unproven, proofLine, StringComparison.Ordinal);
        report += $"\n\n## Designated Azure SMB proof\n\n" +
            $"- Date (UTC): {DateTimeOffset.UtcNow:yyyy-MM-dd HH:mm:ss 'UTC'}\n" +
            $"- Command: `scripts/verify-storage.sh --azure`\n" +
            $"- Image digest: `{image}`\n" +
            $"- Runtime: `{System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription}`\n" +
            $"- Kernel: `{kernel}`\n" +
            $"- Proof run id: `{runId}`\n" +
            $"- SMB dialect: `{dialect}`\n" +
            $"- Share SKU: `{Environment.GetEnvironmentVariable("STORAGE_PROOF_SHARE_SKU")}`; billing model: `{Environment.GetEnvironmentVariable("STORAGE_PROOF_BILLING_MODEL")}`\n" +
            $"- Effective mount options at `{mountPath}` (credentials redacted): `{redactedOptions}`\n" +
            "- `nobrl` and `nostrictsync`: rejected; neither option is present.\n" +
            "- Two independently mounted client containers raced first stream creation and same-key commands; a verifier container observed the durable committed versions.\n" +
            "- Network interruption/reconnect, overlapping revisions, crash points, and independent backup/restore remain unproven.\n";
        await File.WriteAllTextAsync(reportPath!, report);

        static string? FindMount(string path)
        {
            var fullPath = Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar);
            return File.ReadLines("/proc/mounts")
                .Select(line => (Line: line, Fields: line.Split(' ', StringSplitOptions.RemoveEmptyEntries)))
                .Where(entry => entry.Fields.Length >= 3)
                .Where(entry => DecodeMountPath(entry.Fields[1]) == fullPath)
                .Select(entry => entry.Line)
                .FirstOrDefault();
        }

        static string DecodeMountPath(string value) => value.Replace("\\040", " ", StringComparison.Ordinal)
            .Replace("\\011", "\t", StringComparison.Ordinal)
            .Replace("\\134", "\\", StringComparison.Ordinal);
    }

    private static async Task<WorkerResult> ReadOutcome(string path)
    {
        Assert.True(File.Exists(path), $"Missing independent-client result file: {path}");
        return JsonSerializer.Deserialize<WorkerResult>(await File.ReadAllTextAsync(path))!;
    }

    private static void AssertCompleteLine(string path)
    {
        var bytes = File.ReadAllBytes(path);
        Assert.NotEmpty(bytes);
        Assert.Equal((byte)'\n', bytes[^1]);
    }

    private static async Task AssertChangedBodyConflicts(JsonlEventStore store)
    {
        var existing = Assert.Single(await store.ReadAsync("user_StorageIdempotency"));
        var command = new CommandPipeline(store, TimeProvider.System, Guid.NewGuid);
        using var body = JsonDocument.Parse("{\"currency\":\"USD\",\"timeZone\":\"Europe/Berlin\"}");
        var error = await Assert.ThrowsAsync<CommandConflictException>(() => command.ExecuteAsync("user_StorageIdempotency",
            new CommandRequest("POST", "/api/configuration", body.RootElement.Clone(), existing.IdempotencyKey, 0),
            _ => throw new InvalidOperationException("Changed idempotency body must not reach the decision callback."),
            (_, _) => throw new InvalidOperationException("Changed idempotency body must not return a success response.")));
        Assert.Equal("idempotency_conflict", error.Code);
    }

    private static string RedactMountOption(string option)
    {
        var name = option.Split('=', 2)[0];
        return name.Equals("username", StringComparison.OrdinalIgnoreCase) ||
               name.Equals("password", StringComparison.OrdinalIgnoreCase) ||
               name.Equals("pass", StringComparison.OrdinalIgnoreCase) ||
               name.Equals("credentials", StringComparison.OrdinalIgnoreCase)
            ? name + "=<redacted>"
            : option;
    }

    private sealed record WorkerResult(string Status, long Version);
}
