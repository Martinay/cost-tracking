using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using CostTracking.Api.Domain;
using Microsoft.Extensions.Logging;

namespace CostTracking.Api.Storage;

/// <summary>Reads and appends a subject-local JSONL stream under a single stable-file guard.</summary>
public sealed class JsonlEventStore(string root, SubjectLock subjectLock,
    Action<FileStream>? flush = null, Action<string, byte[]>? backup = null, ILogger<JsonlEventStore>? logger = null)
{
    private readonly Action<FileStream> durableFlush = flush ?? (file => file.Flush(flushToDisk: true));
    private readonly Action<string, byte[]> preserveOriginal = backup ?? Backup;

    public string PathFor(string subject)
    {
        if (!Regex.IsMatch(subject, @"\Auser_[A-Za-z0-9]+\z", RegexOptions.CultureInvariant))
            throw new ArgumentException("Invalid user subject.", nameof(subject));
        var hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(subject)));
        return Path.Combine(root, "users", hash, $"events_{hash}.jsonl");
    }

    public async Task<T> WithLockAsync<T>(string subject, Func<LockedEventStream, T> operation, CancellationToken cancellationToken = default)
    {
        var path = PathFor(subject);
        using var held = await subjectLock.AcquireAsync(path, cancellationToken);
        var stage = "replay";
        try
        {
            var stream = held.Stream;
            using var buffer = new MemoryStream();
            stream.CopyTo(buffer);
            var bytes = buffer.ToArray();
            var serializer = new EventSerializer();
            var events = new List<EventEnvelope>();
            var start = 0;
            for (var index = 0; index < bytes.Length; index++)
            {
                if (bytes[index] != (byte)'\n') continue;
                events.Add(serializer.Deserialize(bytes.AsSpan(start, index - start)));
                start = index + 1;
            }
            var projection = AccountProjection.Replay(subject, events);
            if (start < bytes.Length)
            {
                preserveOriginal(path + ".recovery-" + Guid.NewGuid().ToString("N"), bytes);
                stream.SetLength(start);
                durableFlush(stream);
            }
            cancellationToken.ThrowIfCancellationRequested();
            stage = "command";
            return operation(new LockedEventStream(subject, stream, projection.Events, durableFlush));
        }
        catch (InvalidDataException)
        {
            if (stage == "replay") LogStorageFailure("EventReplayFailure", LogLevel.Error);
            throw;
        }
        catch (IOException)
        {
            LogStorageFailure(stage == "replay" ? "EventReplayFailure" : "EventAppendFailure", LogLevel.Error);
            throw;
        }
    }

    private void LogStorageFailure(string failureClass, LogLevel level) =>
        logger?.Log(level, new EventId(5301, failureClass),
            "Storage failure {StorageFailureClass}", failureClass);

    public Task<IReadOnlyList<EventEnvelope>> ReadAsync(string subject, CancellationToken cancellationToken = default) =>
        WithLockAsync(subject, stream => stream.Events, cancellationToken);

    private static void Backup(string path, byte[] original)
    {
        if (OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Storage requires Linux.");
        using var file = new FileStream(path, new FileStreamOptions
        {
            Mode = FileMode.CreateNew, Access = FileAccess.Write, Share = FileShare.None,
            UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite
        });
        file.Write(original);
        file.Flush(flushToDisk: true);
    }
}

public sealed class LockedEventStream(string subject, FileStream file, IReadOnlyList<EventEnvelope> events,
    Action<FileStream> flush)
{
    private bool appended;
    public IReadOnlyList<EventEnvelope> Events { get; private set; } = events;

    /// <summary>Appends at most one valid event, ignoring request cancellation once the append begins.</summary>
    public void Append(EventEnvelope value)
    {
        if (appended) throw new InvalidOperationException("One command may append only one event.");
        var projection = AccountProjection.Replay(subject, Events.Append(value));
        var bytes = new EventSerializer().Serialize(value);
        file.Position = file.Length;
        file.Write(bytes);
        file.WriteByte((byte)'\n');
        flush(file);
        appended = true;
        Events = projection.Events;
    }
}
