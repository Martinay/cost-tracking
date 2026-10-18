using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CostTracking.Api.Domain;
using CostTracking.Api.Storage;

namespace CostTracking.Tests.Storage;

public sealed class EventStoreTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "cost-store-" + Guid.NewGuid().ToString("N"));
    private const string Subject = "user_Alice";
    private static SubjectLock LocalLock() => new((_, _) => 0);
    public static EventEnvelope Event(long version = 1, string subject = Subject) => new(
        Guid.NewGuid(), version, 1, "AccountConfigured", subject,
        new DateTimeOffset(2026, 9, 21, 12, 0, 0, TimeSpan.Zero), Guid.NewGuid(), new string('a', 64),
        JsonSerializer.SerializeToElement(new { currency = "EUR", timeZone = "Europe/Berlin" }));

    [Fact]
    public void Subject_must_match_the_entire_user_identifier()
    {
        var store = new JsonlEventStore(root, LocalLock());
        Assert.Throws<ArgumentException>(() => store.PathFor("user_Alice\n"));
    }

    [Fact]
    public async Task First_creation_uses_subject_hash_and_preserves_the_open_file()
    {
        var store = new JsonlEventStore(root, LocalLock());
        var hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(Subject)));
        Assert.Equal(Path.Combine(root, "users", hash, $"events_{hash}.jsonl"), store.PathFor(Subject));
        await store.WithLockAsync(Subject, stream => { stream.Append(Event()); return 0; });
        using var before = File.OpenRead(store.PathFor(Subject));
        await store.WithLockAsync(Subject, stream => { stream.Append(Event(2)); return 0; });
        Assert.Equal(2, (await store.ReadAsync(Subject)).Count);
        Assert.Equal(new FileInfo(store.PathFor(Subject)).Length, before.Length);
        Assert.EndsWith("\n", await File.ReadAllTextAsync(store.PathFor(Subject)));
    }

    [Fact]
    public async Task Concurrent_first_creators_serialize_before_reading_versions()
    {
        var store = new JsonlEventStore(root, LocalLock());
        await Task.WhenAll(Enumerable.Range(0, 12).Select(_ => Task.Run(() => store.WithLockAsync(Subject,
            stream => { stream.Append(Event(stream.Events.Count + 1)); return 0; }))));
        Assert.Equal(Enumerable.Range(1, 12).Select(i => (long)i), (await store.ReadAsync(Subject)).Select(e => e.StreamVersion));
    }

    [Fact]
    public async Task Acknowledgment_waits_for_flush_and_flush_failure_is_visible()
    {
        var flushed = false;
        var store = new JsonlEventStore(root, LocalLock(), file => { Assert.True(file.Length > 0); file.Flush(true); flushed = true; });
        await store.WithLockAsync(Subject, stream => { stream.Append(Event()); return 0; });
        Assert.True(flushed);
        var failing = new JsonlEventStore(root, LocalLock(), _ => throw new IOException("injected flush failure"));
        await Assert.ThrowsAsync<IOException>(() => failing.WithLockAsync(Subject, stream => { stream.Append(Event(2)); return 0; }));
    }

    [Fact]
    public async Task Partial_tail_is_backed_up_byte_for_byte_then_repaired()
    {
        var store = new JsonlEventStore(root, LocalLock());
        await store.WithLockAsync(Subject, s => { s.Append(Event()); return 0; });
        var path = store.PathFor(Subject);
        await File.AppendAllTextAsync(path, "{\"partial\":");
        var original = await File.ReadAllBytesAsync(path);
        Assert.Single(await store.ReadAsync(Subject));
        var backup = Assert.Single(Directory.GetFiles(Path.GetDirectoryName(path)!, "*.recovery-*"));
        Assert.Equal(original, await File.ReadAllBytesAsync(backup));
        Assert.Equal(original.Length - 11, new FileInfo(path).Length);
        if (!OperatingSystem.IsWindows()) Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(backup));
    }

    [Fact]
    public async Task Failed_backup_prevents_truncation_and_failed_repair_is_not_success()
    {
        var store = new JsonlEventStore(root, LocalLock());
        await store.WithLockAsync(Subject, s => { s.Append(Event()); return 0; });
        await File.AppendAllTextAsync(store.PathFor(Subject), "partial");
        var original = await File.ReadAllBytesAsync(store.PathFor(Subject));
        var failingBackup = new JsonlEventStore(root, LocalLock(), backup: (_, _) => throw new IOException("backup failed"));
        await Assert.ThrowsAsync<IOException>(() => failingBackup.ReadAsync(Subject));
        Assert.Equal(original, await File.ReadAllBytesAsync(store.PathFor(Subject)));
        var failingRepair = new JsonlEventStore(root, LocalLock(), _ => throw new IOException("repair flush failed"));
        await Assert.ThrowsAsync<IOException>(() => failingRepair.ReadAsync(Subject));
        Assert.NotEmpty(Directory.GetFiles(Path.GetDirectoryName(store.PathFor(Subject))!, "*.recovery-*"));
    }

    [Fact]
    public async Task Corrupt_committed_lines_are_not_skipped_or_changed()
    {
        var store = new JsonlEventStore(root, LocalLock());
        await store.ReadAsync(Subject);
        var path = store.PathFor(Subject);
        await File.WriteAllTextAsync(path, "{corrupt}\npartial");
        var original = await File.ReadAllBytesAsync(path);
        await Assert.ThrowsAsync<InvalidDataException>(() => store.ReadAsync(Subject));
        Assert.Equal(original, await File.ReadAllBytesAsync(path));
    }

    [Fact]
    public async Task Unsupported_native_lock_fails_closed_and_does_not_append()
    {
        var store = new JsonlEventStore(root, new SubjectLock((_, _) => 95));
        await Assert.ThrowsAsync<IOException>(() => store.WithLockAsync(Subject, s => { s.Append(Event()); return 0; }));
        Assert.Equal(0, new FileInfo(store.PathFor(Subject)).Length);
    }

    [Fact]
    public async Task Contention_times_out_and_cancellation_releases_local_guard()
    {
        var path = Path.Combine(root, "lock.jsonl");
        var busy = new SubjectLock((_, _) => 11, TimeSpan.Zero);
        await Assert.ThrowsAsync<TimeoutException>(() => busy.AcquireAsync(path));
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => LocalLock().AcquireAsync(path, cancellation.Token));
        using var released = await LocalLock().AcquireAsync(path);
        Assert.True(released.Stream.CanWrite);
    }

    [Fact]
    public async Task Interrupted_native_calls_retry_and_release_on_callback_failure()
    {
        var attempts = 0;
        var released = 0;
        var subjectLock = new SubjectLock((_, unlock) =>
        {
            if (unlock) { released++; return 0; }
            return ++attempts < 3 ? 4 : 0;
        });
        var store = new JsonlEventStore(root, subjectLock);
        await Assert.ThrowsAsync<InvalidOperationException>(() => store.WithLockAsync<int>(Subject, _ => throw new InvalidOperationException()));
        Assert.Equal(3, attempts);
        Assert.Equal(1, released);
        Assert.Empty(await store.ReadAsync(Subject));
    }

    [Fact]
    public async Task Waiting_local_guard_honors_cancellation_without_releasing_another_owner()
    {
        var path = Path.Combine(root, "held.jsonl");
        var subjectLock = LocalLock();
        using var held = await subjectLock.AcquireAsync(path);
        using var cancellation = new CancellationTokenSource();
        var waiting = subjectLock.AcquireAsync(path, cancellation.Token);
        Assert.False(waiting.IsCompleted);
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => waiting);
        Assert.True(held.Stream.CanWrite);
    }

    public void Dispose() { if (Directory.Exists(root)) Directory.Delete(root, true); }
}
