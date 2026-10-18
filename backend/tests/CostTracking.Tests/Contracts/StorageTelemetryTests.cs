using System.Security.Claims;
using CostTracking.Api.Contracts;
using CostTracking.Api.Domain;
using CostTracking.Api.Storage;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace CostTracking.Tests.Contracts;

public sealed class StorageTelemetryTests
{
    [Theory]
    [InlineData("lock_timeout", "StorageLockTimeout", typeof(TimeoutException))]
    [InlineData("stream_unreadable", "EventStreamUnreadable", typeof(InvalidDataException))]
    [InlineData("storage_unavailable", "StorageUnavailable", typeof(IOException))]
    public async Task Storage_failures_have_safe_classified_logs_and_retryable_http_errors(
        string responseCode, string expectedClass, Type failureType)
    {
        var entries = new List<CapturedLog>();
        var logger = new CaptureLogger<ApiProtocol>(entries);
        var context = new DefaultHttpContext();
        context.Request.Path = "/api/v1/account";
        context.Request.Method = HttpMethods.Get;
        context.User = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim("sub", "user_Alice")], "test"));
        context.Response.Body = new MemoryStream();
        var failure = (Exception)Activator.CreateInstance(failureType, "private-path-and-payload")!;
        var protocol = new ApiProtocol(_ => Task.FromException(failure), logger);

        await protocol.InvokeAsync(context);

        Assert.Equal(StatusCodes.Status503ServiceUnavailable, context.Response.StatusCode);
        Assert.Equal("1", context.Response.Headers.RetryAfter.ToString());
        context.Response.Body.Position = 0;
        using var body = await System.Text.Json.JsonDocument.ParseAsync(context.Response.Body);
        Assert.Equal(responseCode, body.RootElement.GetProperty("code").GetString());
        var entry = Assert.Single(entries);
        Assert.Equal(expectedClass, entry.EventName);
        Assert.Contains(expectedClass, entry.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("private-path-and-payload", entry.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("user_Alice", entry.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Event_store_labels_replay_and_append_failures_without_logging_private_details()
    {
        var root = Path.Combine(Path.GetTempPath(), "cost-storage-telemetry-" + Guid.NewGuid().ToString("N"));
        var entries = new List<CapturedLog>();
        var logger = new CaptureLogger<JsonlEventStore>(entries);
        var eventStore = new JsonlEventStore(root, new SubjectLock((_, _) => 0),
            flush: _ => throw new IOException("private-payload-and-path"), logger: logger);
        try
        {
            var path = eventStore.PathFor("user_Alice");
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            await File.WriteAllTextAsync(path, "not-json\n");
            await Assert.ThrowsAsync<InvalidDataException>(() => eventStore.ReadAsync("user_Alice"));
            Assert.Equal("EventReplayFailure", Assert.Single(entries).EventName);

            File.Delete(path);
            entries.Clear();
            await Assert.ThrowsAsync<IOException>(() => eventStore.WithLockAsync("user_Alice", stream =>
            {
                stream.Append(CostTracking.Tests.Storage.EventStoreTests.Event());
                return 0;
            }));
            var appendFailure = Assert.Single(entries);
            Assert.Equal("EventAppendFailure", appendFailure.EventName);
            Assert.Contains("EventAppendFailure", appendFailure.Message, StringComparison.Ordinal);
            Assert.DoesNotContain("private-payload-and-path", appendFailure.Message, StringComparison.Ordinal);
            Assert.DoesNotContain("user_Alice", appendFailure.Message, StringComparison.Ordinal);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    private sealed record CapturedLog(string? EventName, string Message);

    private sealed class CaptureLogger<T>(ICollection<CapturedLog> entries) : ILogger<T>
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter) => entries.Add(new CapturedLog(eventId.Name, formatter(state, exception)));
    }
}
