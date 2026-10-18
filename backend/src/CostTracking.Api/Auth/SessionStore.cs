using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CostTracking.Api.Storage;
using Microsoft.AspNetCore.DataProtection;

namespace CostTracking.Api.Auth;

public sealed record StoredSession(string Subject, string SessionId, string AccessToken, string RefreshToken,
    DateTimeOffset ExpiresAt, DateTimeOffset AbsoluteExpiry, string CsrfToken);

public sealed class SessionStore(string root, IDataProtectionProvider protection, SubjectLock subjectLock)
{
    private readonly IDataProtector protector = protection.CreateProtector("CostTracking.AuthSession.v1");

    public string Handle() => Base64Url(RandomNumberGenerator.GetBytes(32));

    public Task<StoredSession?> ReadAsync(string handle, CancellationToken cancellationToken = default) =>
        WithLockAsync(handle, _ => Read(handle), cancellationToken);

    public Task WriteAsync(string handle, StoredSession session, CancellationToken cancellationToken = default) =>
        WithLockAsync(handle, _ => { Write(handle, session); return true; }, cancellationToken);

    public Task<StoredSession?> UpdateAsync(string handle, Func<StoredSession?, StoredSession?> update,
        CancellationToken cancellationToken = default) =>
        WithLockAsync(handle, stream =>
        {
            var current = Read(handle);
            var next = update(current);
            if (next is null) File.Delete(DataPath(handle));
            else Write(handle, next);
            return next;
        }, cancellationToken);

    public Task<StoredSession?> UpdateAsync(string handle, Func<StoredSession?, CancellationToken, Task<StoredSession?>> update,
        CancellationToken cancellationToken = default) =>
        WithLockAsync(handle, async stream =>
        {
            var current = Read(handle);
            var next = await update(current, cancellationToken);
            if (next is null) File.Delete(DataPath(handle));
            else Write(handle, next);
            return next;
        }, cancellationToken);

    private async Task<T> WithLockAsync<T>(string handle, Func<FileStream, Task<T>> action, CancellationToken cancellationToken)
    {
        var path = LockPath(handle);
        using var held = await subjectLock.AcquireAsync(path, cancellationToken);
        return await action(held.Stream);
    }

    private Task<T> WithLockAsync<T>(string handle, Func<FileStream, T> action, CancellationToken cancellationToken) =>
        WithLockAsync(handle, stream => Task.FromResult(action(stream)), cancellationToken);

    private StoredSession? Read(string handle)
    {
        var path = DataPath(handle);
        if (!File.Exists(path)) return null;
        var encrypted = File.ReadAllBytes(path);
        var json = protector.Unprotect(encrypted);
        return JsonSerializer.Deserialize<StoredSession>(json) ?? throw new InvalidDataException("Session payload is unreadable.");
    }

    private void Write(string handle, StoredSession value)
    {
        if (OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Session storage requires POSIX file permissions.");
        var path = DataPath(handle);
        var protectedBytes = protector.Protect(JsonSerializer.SerializeToUtf8Bytes(value));
        var temporary = path + "." + Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(12)) + ".tmp";
        using (var file = new FileStream(temporary, new FileStreamOptions
        {
            Mode = FileMode.CreateNew, Access = FileAccess.Write, Share = FileShare.None,
            UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite
        }))
        {
            file.Write(protectedBytes);
            file.Flush(flushToDisk: true);
        }
        File.Move(temporary, path, overwrite: true);
    }

    private string LockPath(string handle)
    {
        if (OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Session storage requires POSIX file permissions.");
        var path = DataPath(handle);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        return Path.ChangeExtension(path, ".lock");
    }

    private string DataPath(string handle)
    {
        if (string.IsNullOrWhiteSpace(handle) || handle.Length > 128) throw new ArgumentException("Invalid session handle.", nameof(handle));
        var hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(handle)));
        return Path.Combine(root, "auth", "sessions", hash + ".session");
    }

    private static string Base64Url(byte[] bytes) => Microsoft.AspNetCore.WebUtilities.WebEncoders.Base64UrlEncode(bytes);
}
