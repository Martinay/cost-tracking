using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace CostTracking.Api.Storage;

/// <summary>Holds a process semaphore and checked Linux flock on the stable open stream inode.</summary>
public sealed class SubjectLock(Func<SafeFileHandle, bool, int>? native = null, TimeSpan? timeout = null)
{
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> Guards = new(StringComparer.Ordinal);
    private readonly Func<SafeFileHandle, bool, int> nativeLock = native ?? LinuxLock;
    private readonly TimeSpan deadline = timeout ?? TimeSpan.FromSeconds(5);

    public async Task<LockedFile> AcquireAsync(string path, CancellationToken cancellationToken = default)
    {
        if (OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Storage requires Linux.");
        path = Path.GetFullPath(path);
        var timer = Stopwatch.StartNew();
        var semaphore = Guards.GetOrAdd(path, _ => new SemaphoreSlim(1, 1));
        if (!await semaphore.WaitAsync(deadline, cancellationToken)) throw new TimeoutException("Storage lock deadline exceeded.");
        FileStream? stream = null;
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            Directory.CreateDirectory(Path.GetDirectoryName(path)!, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            stream = OpenStream(path);
            var handle = stream.SafeFileHandle;
            while (true)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var error = nativeLock(handle, false);
                if (error == 0) return new LockedFile(stream, semaphore, nativeLock);
                if (error is not (4 or 11)) throw new IOException($"Storage lock unavailable ({error}).");
                var remaining = deadline - timer.Elapsed;
                if (remaining <= TimeSpan.Zero) throw new TimeoutException("Storage lock deadline exceeded.");
                if (error == 4) continue;
                await Task.Delay(remaining < TimeSpan.FromMilliseconds(20) ? remaining : TimeSpan.FromMilliseconds(20), cancellationToken);
            }
        }
        catch
        {
            stream?.Dispose();
            semaphore.Release();
            throw;
        }
    }

    private FileStream OpenStream(string path)
    {
        if (!OperatingSystem.IsLinux())
        {
            if (native is null) throw new IOException("Production storage locking requires Linux.");
            return new FileStream(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.ReadWrite);
        }
        // Native open avoids FileStream's implicit shared flock before the explicit exclusive lock.
        var descriptor = Open(path, 2 | 64, 0x180);
        if (descriptor < 0) throw new IOException($"Storage open failed ({Marshal.GetLastPInvokeError()}).");
        var handle = new SafeFileHandle((IntPtr)descriptor, ownsHandle: true);
        try { return new FileStream(handle, FileAccess.ReadWrite); }
        catch { handle.Dispose(); throw; }
    }

    private static int LinuxLock(SafeFileHandle handle, bool unlock)
    {
        if (!OperatingSystem.IsLinux()) return 95;
        return Flock(handle, unlock ? 8 : 2 | 4) == 0 ? 0 : Marshal.GetLastPInvokeError();
    }

    [DllImport("libc", EntryPoint = "open", SetLastError = true)]
    private static extern int Open([MarshalAs(UnmanagedType.LPUTF8Str)] string path, int flags, uint mode);

    [DllImport("libc", EntryPoint = "flock", SetLastError = true)]
    private static extern int Flock(SafeFileHandle handle, int operation);
}

public sealed class LockedFile(FileStream stream, SemaphoreSlim semaphore, Func<SafeFileHandle, bool, int> nativeLock) : IDisposable
{
    private bool disposed;
    public FileStream Stream { get; } = stream;
    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        var error = 0;
        try { error = nativeLock(Stream.SafeFileHandle, true); }
        finally { Stream.Dispose(); semaphore.Release(); }
        if (error != 0) throw new IOException($"Storage unlock failed ({error}).");
    }
}
