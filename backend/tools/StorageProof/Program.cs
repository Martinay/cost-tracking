using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CostTracking.Api.Domain;
using CostTracking.Api.Storage;
using CostTracking.Api.Auth;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.DependencyInjection;

if (args.Length > 0 && args[0] == "worker")
{
    await Worker(args[1..]);
    return;
}

if (args.Length != 2)
    throw new ArgumentException("Usage: StorageProof <report-path> <image-reference>");

var reportPath = args[0];
var imageReference = args[1];
var proofRoot = Path.Combine(Path.GetTempPath(), "cost-tracking-storage-proof-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(proofRoot);
var results = new List<(string Name, string Detail)>();
try
{
    await FirstCreationAndVersionRace(proofRoot, results);
    await SameKeyRaceAndRetry(proofRoot, results);
    await CrossProcessReadAndDurableAppend(proofRoot, results);
    await PartialTailRecovery(proofRoot, results);
    await UnsupportedLockFailsClosed(proofRoot, results);
    await ContentionTimesOut(proofRoot, results);
    await SessionStoreUsesPathIndependentLock(proofRoot, results);

    var report = BuildReport(imageReference, proofRoot, results);
    Directory.CreateDirectory(Path.GetDirectoryName(reportPath)!);
    await File.WriteAllTextAsync(reportPath, report + "\n", new UTF8Encoding(false));
    Console.WriteLine(report);
}
finally
{
    if (Directory.Exists(proofRoot)) Directory.Delete(proofRoot, recursive: true);
}

static async Task FirstCreationAndVersionRace(string root, List<(string, string)> results)
{
    var scenario = Path.Combine(root, "first-create");
    Directory.CreateDirectory(scenario);
    var subject = "user_FirstCreate";
    var keyA = Guid.NewGuid();
    var keyB = Guid.NewGuid();
    var workers = await StartRacers(scenario, subject,
        new WorkerCommand(keyA, 0, "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}"),
        new WorkerCommand(keyB, 0, "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}"));
    var outcomes = await Task.WhenAll(workers.Select(CompleteWorker));
    Require(outcomes.Count(x => x.Status == "committed") == 1, "same-version race must have one commit");
    Require(outcomes.Count(x => x.Status == "version_conflict") == 1, "same-version race must have one conflict");
    var events = await new JsonlEventStore(scenario, new SubjectLock()).ReadAsync(subject);
    Require(events.Count == 1 && events[0].StreamVersion == 1, "first creation must make one contiguous event");
    results.Add(("Two-process first creation and same-version race", "PASS: one committed version 1 event, one recoverable version conflict; both clients opened the same newly created stream."));
}

static async Task SameKeyRaceAndRetry(string root, List<(string, string)> results)
{
    var scenario = Path.Combine(root, "same-key");
    Directory.CreateDirectory(scenario);
    var subject = "user_SameKey";
    var key = Guid.NewGuid();
    const string body = "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}";
    var workers = await StartRacers(scenario, subject,
        new WorkerCommand(key, 0, body), new WorkerCommand(key, 0, body));
    var outcomes = await Task.WhenAll(workers.Select(CompleteWorker));
    Require(outcomes.All(x => x.Status == "committed" && x.Version == 1), "same-key concurrent clients must receive version 1");
    var replay = await RunWorker(scenario, subject, new WorkerCommand(key, 0, body));
    Require(replay.Status == "committed" && replay.Version == 1, "stale-version exact retry must recover original response");
    var changed = await RunWorker(scenario, subject, new WorkerCommand(key, 0, "{\"currency\":\"USD\",\"timeZone\":\"Europe/Berlin\"}"));
    Require(changed.Status == "idempotency_conflict", "same key with changed body must conflict");
    var events = await new JsonlEventStore(scenario, new SubjectLock()).ReadAsync(subject);
    Require(events.Count == 1, "idempotent retries must not append duplicate events");
    results.Add(("Two-process idempotency race", "PASS: same key/body returned the original version to both clients and a stale retry; changed body conflicted; exactly one event persisted."));
}

static async Task CrossProcessReadAndDurableAppend(string root, List<(string, string)> results)
{
    var scenario = Path.Combine(root, "fresh-reader");
    Directory.CreateDirectory(scenario);
    var subject = "user_FreshReader";
    var committed = await RunWorker(scenario, subject,
        new WorkerCommand(Guid.NewGuid(), 0, "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}"));
    Require(committed.Status == "committed" && committed.Version == 1, "writer must return only after durable append");
    var reader = await RunReader(scenario, subject);
    Require(reader.Status == "read" && reader.Version == 1, "fresh process must observe committed version immediately");
    var path = new JsonlEventStore(scenario, new SubjectLock()).PathFor(subject);
    var bytes = await File.ReadAllBytesAsync(path);
    Require(bytes.Length > 0 && bytes[^1] == (byte)'\n', "durable JSONL append must include its committed line terminator");
    results.Add(("Cross-process freshness and durable append", "PASS: independent reader process observed committed version 1; stream ended in a complete newline-terminated event after writer acknowledgment."));
}

static async Task PartialTailRecovery(string root, List<(string, string)> results)
{
    var scenario = Path.Combine(root, "recovery");
    Directory.CreateDirectory(scenario);
    var subject = "user_Recovery";
    var store = new JsonlEventStore(scenario, new SubjectLock());
    await store.WithLockAsync(subject, stream => { stream.Append(Event(subject, 1)); return 0; });
    var path = store.PathFor(subject);
    await File.AppendAllTextAsync(path, "{\"partial\":", new UTF8Encoding(false));
    var original = await File.ReadAllBytesAsync(path);
    var reader = await RunReader(scenario, subject);
    Require(reader.Status == "read" && reader.Version == 1, "recovery must retain committed event and discard only incomplete tail");
    var backup = Directory.GetFiles(Path.GetDirectoryName(path)!, "*.recovery-*").Single();
    var backupBytes = await File.ReadAllBytesAsync(backup);
    Require(original.SequenceEqual(backupBytes), "recovery backup must preserve original bytes");
    Require((await File.ReadAllBytesAsync(path)).Last() == (byte)'\n', "recovered stream must end at last complete event");
    results.Add(("Partial-tail recovery", "PASS: independent reader preserved the original bytes in a restricted recovery backup and restored the committed prefix."));
}

static async Task UnsupportedLockFailsClosed(string root, List<(string, string)> results)
{
    var scenario = Path.Combine(root, "unsupported-lock");
    var store = new JsonlEventStore(scenario, new SubjectLock((_, _) => 95));
    var failedClosed = false;
    try { await store.WithLockAsync("user_Unsupported", stream => { stream.Append(Event("user_Unsupported", 1)); return 0; }); }
    catch (IOException exception) when (exception.Message.Contains("Storage lock unavailable", StringComparison.Ordinal)) { failedClosed = true; }
    Require(failedClosed, "unsupported native lock must fail closed");
    var path = store.PathFor("user_Unsupported");
    Require(!File.Exists(path) || new FileInfo(path).Length == 0, "unsupported lock must not append an event");
    results.Add(("Unsupported lock", "PASS: injected unsupported-lock errno failed closed with no event append. This checks the error path, not remote SMB lock support."));
}

static async Task ContentionTimesOut(string root, List<(string, string)> results)
{
    var scenario = Path.Combine(root, "timeout");
    Directory.CreateDirectory(scenario);
    const string subject = "user_Timeout";
    var path = new JsonlEventStore(scenario, new SubjectLock()).PathFor(subject);
    var ready = Path.Combine(scenario, "held.ready");
    var release = Path.Combine(scenario, "release");
    var holder = StartProcess("worker", "hold-lock", scenario, subject, ready, release);
    await WaitForFile(ready);
    var timedOut = false;
    try { using var ignored = await new SubjectLock(timeout: TimeSpan.FromMilliseconds(150)).AcquireAsync(path); }
    catch (TimeoutException) { timedOut = true; }
    await File.WriteAllTextAsync(release, "release");
    await EnsureSuccess(holder);
    holder.Dispose();
    Require(timedOut, "lock contention must respect a bounded timeout");
    Require(new FileInfo(path).Length == 0, "lock timeout must not append an event");
    results.Add(("Independent process lock holder timeout", "PASS: a second process timed out on the real Linux flock held by the first process; no event was appended."));
}

static async Task SessionStoreUsesPathIndependentLock(string root, List<(string, string)> results)
{
    var directory = Path.Combine(root, "session-key-ring");
    var services = new ServiceCollection();
    services.AddDataProtection().SetApplicationName("CostTracking.StorageProof")
        .PersistKeysToFileSystem(new DirectoryInfo(directory));
    using var provider = services.BuildServiceProvider();
    var store = new SessionStore(root, provider.GetRequiredService<IDataProtectionProvider>(), new SubjectLock());
    var handle = store.Handle();
    var expected = new StoredSession("user_Session", "sid_session", "access_token-private", "refresh_token-private",
        DateTimeOffset.UtcNow.AddMinutes(5), DateTimeOffset.UtcNow.AddDays(1), "csrf-private");
    await store.WriteAsync(handle, expected);
    var actual = await store.ReadAsync(handle);
    Require(actual == expected, "session payload must round-trip under Linux's handle-only FileStream lock");
    var sessionFile = Directory.GetFiles(Path.Combine(root, "auth", "sessions"), "*.session").Single();
    var encrypted = await File.ReadAllTextAsync(sessionFile);
    Require(!encrypted.Contains(expected.AccessToken, StringComparison.Ordinal) &&
        !encrypted.Contains(expected.RefreshToken, StringComparison.Ordinal), "session tokens must not be written as plaintext");
    results.Add(("Encrypted session storage with native Linux flock", "PASS: encrypted session data was readable by handle after writing under an actual Linux stable-file flock; no token appeared as plaintext."));
}

static async Task<List<WorkerProcess>> StartRacers(string root, string subject, WorkerCommand first, WorkerCommand second)
{
    var start = Path.Combine(root, "go");
    var a = StartWorker(root, subject, first, "race-a", start);
    var b = StartWorker(root, subject, second, "race-b", start);
    var readyA = Path.Combine(root, "race-a.ready");
    var readyB = Path.Combine(root, "race-b.ready");
    await WaitForFile(readyA);
    await WaitForFile(readyB);
    await File.WriteAllTextAsync(start, "go");
    return [a, b];
}

static async Task<WorkerOutcome> RunWorker(string root, string subject, WorkerCommand command)
{
    var worker = StartWorker(root, subject, command, Guid.NewGuid().ToString("N"), null);
    return await CompleteWorker(worker);
}

static async Task<WorkerOutcome> RunReader(string root, string subject)
{
    var name = Guid.NewGuid().ToString("N");
    var output = Path.Combine(root, name + ".json");
    var process = StartProcess("worker", "read", root, subject, output);
    await EnsureSuccess(process);
    return JsonSerializer.Deserialize<WorkerOutcome>(await File.ReadAllTextAsync(output))!;
}

static WorkerProcess StartWorker(string root, string subject, WorkerCommand command, string name, string? start)
{
    var output = Path.Combine(root, name + ".json");
    var process = start is null
        ? StartProcess("worker", "command", root, subject, name, output, command.Key.ToString("D"), command.ExpectedVersion.ToString(), command.Body)
        : StartProcess("worker", "race-command", root, subject, name, output, command.Key.ToString("D"), command.ExpectedVersion.ToString(), command.Body, start);
    return new WorkerProcess(process, output);
}

static Process StartProcess(params string[] arguments)
{
    var assembly = Assembly.GetExecutingAssembly().Location;
    var startInfo = new ProcessStartInfo("dotnet") { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
    startInfo.ArgumentList.Add(assembly);
    foreach (var argument in arguments) startInfo.ArgumentList.Add(argument);
    return Process.Start(startInfo) ?? throw new InvalidOperationException("Could not start storage proof worker process.");
}

static async Task<WorkerOutcome> CompleteWorker(WorkerProcess worker)
{
    await EnsureSuccess(worker.Process);
    worker.Process.Dispose();
    return JsonSerializer.Deserialize<WorkerOutcome>(await File.ReadAllTextAsync(worker.Output))!;
}

static async Task EnsureSuccess(Process process)
{
    await process.WaitForExitAsync();
    if (process.ExitCode == 0) return;
    var stdout = await process.StandardOutput.ReadToEndAsync();
    var stderr = await process.StandardError.ReadToEndAsync();
    throw new InvalidOperationException($"Worker exited {process.ExitCode}. stdout: {stdout} stderr: {stderr}");
}

static async Task WaitForFile(string path)
{
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
    while (!File.Exists(path))
    {
        timeout.Token.ThrowIfCancellationRequested();
        await Task.Delay(10, timeout.Token);
    }
}

static async Task Worker(string[] args)
{
    var mode = args[0];
    if (mode == "read")
    {
        var root = args[1]; var subject = args[2]; var output = args[3];
        var events = await new JsonlEventStore(root, new SubjectLock()).ReadAsync(subject);
        await File.WriteAllTextAsync(output, JsonSerializer.Serialize(new WorkerOutcome("read", events.Count)));
        return;
    }

    if (mode == "hold-lock")
    {
        var root = args[1]; var subject = args[2]; var ready = args[3]; var release = args[4];
        var path = new JsonlEventStore(root, new SubjectLock()).PathFor(subject);
        using var held = await new SubjectLock().AcquireAsync(path);
        await File.WriteAllTextAsync(ready, "held");
        await WaitForFile(release);
        return;
    }

    var dataRoot = args[1];
    var user = args[2];
    var name = args[3];
    var resultPath = args[4];
    var key = Guid.Parse(args[5]);
    var expectedVersion = long.Parse(args[6]);
    using var bodyDocument = JsonDocument.Parse(args[7]);
    if (mode == "race-command")
    {
        var ready = Path.Combine(dataRoot, name + ".ready");
        var start = args[8];
        await File.WriteAllTextAsync(ready, "ready");
        await WaitForFile(start);
    }

    var store = new JsonlEventStore(dataRoot, new SubjectLock());
    var pipeline = new CommandPipeline(store, TimeProvider.System, Guid.NewGuid);
    try
    {
        var request = new CommandRequest("POST", "/api/configuration", bodyDocument.RootElement.Clone(), key, expectedVersion);
        var response = await pipeline.ExecuteAsync(user, request,
            _ => new EventData("AccountConfigured", JsonSerializer.SerializeToElement(new
            {
                currency = bodyDocument.RootElement.GetProperty("currency").GetString(),
                timeZone = bodyDocument.RootElement.GetProperty("timeZone").GetString()
            })),
            (eventValue, _) => new CommandResponse(201, JsonSerializer.SerializeToElement(new { version = eventValue.StreamVersion }), eventValue.StreamVersion));
        await File.WriteAllTextAsync(resultPath, JsonSerializer.Serialize(new WorkerOutcome("committed", response.StreamVersion)));
    }
    catch (CommandConflictException conflict)
    {
        await File.WriteAllTextAsync(resultPath, JsonSerializer.Serialize(new WorkerOutcome(conflict.Code, conflict.StreamVersion)));
    }
}

static EventEnvelope Event(string subject, long version) => new(Guid.NewGuid(), version, 1, "AccountConfigured", subject,
    DateTimeOffset.UtcNow, Guid.NewGuid(), new string('a', 64),
    JsonSerializer.SerializeToElement(new { currency = "EUR", timeZone = "Europe/Berlin" }));

static void Require(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException("Storage proof failed: " + message);
}

static string BuildReport(string image, string proofRoot, List<(string Name, string Detail)> results)
{
    var runtime = RuntimeInformation.FrameworkDescription;
    var kernel = File.Exists("/proc/version") ? File.ReadAllText("/proc/version").Trim() : "unavailable";
    var mount = File.Exists("/proc/mounts")
        ? File.ReadLines("/proc/mounts").FirstOrDefault(line => line.Contains(" / ", StringComparison.Ordinal)) ?? "unavailable"
        : "unavailable";
    var lines = new List<string>
    {
        "# Early storage proof results",
        "",
        $"- Date (UTC): {DateTimeOffset.UtcNow:yyyy-MM-dd HH:mm:ss 'UTC'}",
        "- Runner command: `scripts/storage-proof.sh`",
        "- Scope: local Linux container filesystem only; this is not an Azure Files SMB proof.",
        $"- Container image reference: `{image}`",
        $"- Runtime: `{runtime}`",
        $"- Kernel: `{kernel}`",
        $"- Proof filesystem: container temporary directory on Docker-managed local storage (`{mount}`)",
        "- SMB dialect, share SKU/billing model, effective SMB mount options: not applicable/unavailable; no share was mounted.",
        "- `nobrl` / `nostrictsync` checks: not applicable; no CIFS mount was used.",
        "- Azure target-share proof: UNPROVEN (no designated share configuration or mount was supplied).",
        "",
        "| Local exercise | Result |",
        "|---|---|"
    };
    lines.AddRange(results.Select(result => $"| {result.Name} | {result.Detail} |"));
    lines.AddRange(["", "The local results establish behavior on this Linux container's local filesystem only. They do not satisfy the deployment proof gate for independently mounted SMB clients, remote cache freshness, network faults, mount options, or restore."]);
    return string.Join('\n', lines);
}

sealed record WorkerCommand(Guid Key, long ExpectedVersion, string Body);
sealed record WorkerOutcome(string Status, long Version);
sealed record WorkerProcess(Process Process, string Output);
