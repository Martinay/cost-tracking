using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Threading.RateLimiting;
using CostTracking.Api.Auth;
using CostTracking.Api.Storage;
using Microsoft.AspNetCore.Cors.Infrastructure;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;

namespace CostTracking.Api.Contracts;

public sealed class ApiException(int status, string code, string message, string? field = null, long? version = null) : Exception(message)
{
    public int StatusCode { get; } = status;
    public string Code { get; } = code;
    public string? Field { get; } = field;
    public long? StreamVersion { get; } = version;
}

public sealed record ApiError(string Code, string Message, string CorrelationId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<ApiErrorDetail>? Details = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? StreamVersion = null);

public sealed record ApiErrorDetail(string Field, string Message);

internal sealed class ApiErrorSchemaTransformer : IOpenApiDocumentTransformer
{
    public async Task TransformAsync(OpenApiDocument document, OpenApiDocumentTransformerContext context, CancellationToken cancellationToken)
    {
        document.Components ??= new OpenApiComponents();
        document.Components.Schemas ??= new Dictionary<string, IOpenApiSchema>();
        document.Components.Schemas["ApiError"] = await context.GetOrCreateSchemaAsync(typeof(ApiError), null, cancellationToken);
        document.Components.Schemas["ApiErrorDetail"] = await context.GetOrCreateSchemaAsync(typeof(ApiErrorDetail), null, cancellationToken);
    }
}

public static class ApiProtocolRegistration
{
    public static IServiceCollection AddApiProtocol(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddCors(options =>
        {
            var origin = configuration["Cors:AllowedOrigin"];
            if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri) || uri.Scheme != "https" ||
                uri.GetLeftPart(UriPartial.Authority) != origin || uri.UserInfo.Length != 0)
                throw new InvalidOperationException("Cors:AllowedOrigin must be one exact HTTPS origin.");
            options.AddPolicy("frontend", policy => policy.WithOrigins(origin).AllowAnyMethod().AllowAnyHeader()
                .AllowCredentials().WithExposedHeaders("ETag", "Retry-After"));
        });
        services.AddRateLimiter(options =>
        {
            var permits = configuration.GetValue("RateLimit:PermitLimit", 120);
            if (permits < 1) throw new InvalidOperationException("Rate limit must be positive.");
            options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
                RateLimitPartition.GetFixedWindowLimiter(context.User.FindFirst("sub")?.Value ?? "anonymous", _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = permits, Window = TimeSpan.FromMinutes(1), QueueLimit = 0, AutoReplenishment = true
                }));
            options.OnRejected = async (context, token) =>
            {
                context.HttpContext.Response.Headers.RetryAfter = "60";
                await ApiProtocol.ErrorAsync(context.HttpContext, new ApiException(429, "rate_limited", "Too many requests. Retry later."), token);
            };
        });
        services.AddDataProtection();
        services.AddSingleton<CursorCodec>();
        return services;
    }

    public static IApplicationBuilder UseApiProtocol(this IApplicationBuilder app) =>
        app.UseCors("frontend").UseMiddleware<ApiProtocol>().UseRateLimiter();
}

/// <summary>Enforces bounded strict JSON, command preconditions and safe errors around the API pipeline.</summary>
public sealed class ApiProtocol(RequestDelegate next, ILogger<ApiProtocol> logger)
{
    private const int MaximumBodyBytes = 64 * 1024;
    internal static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        RespectRequiredConstructorParameters = true,
        Converters = { new StrictEnumConverterFactory() }
    };

    public async Task InvokeAsync(HttpContext context)
    {
        context.TraceIdentifier = Guid.NewGuid().ToString("N");
        try
        {
            if (!context.Request.Path.StartsWithSegments("/api/v1")) { await next(context); return; }
            _ = CurrentOwner.Subject(context.User);
            if (HttpMethods.IsPost(context.Request.Method) || HttpMethods.IsPut(context.Request.Method) || HttpMethods.IsPatch(context.Request.Method))
            {
                var bytes = await ReadBoundedAsync(context.Request, context.RequestAborted);
                if (context.Request.Path != "/api/v1/previews/financial") _ = ReadCommand(context.Request);
                using var document = JsonDocument.Parse(bytes);
                EventSerializer.RejectDuplicates(document.RootElement);
                using var body = new MemoryStream(bytes);
                context.Request.Body = body;
                await next(context);
                return;
            }
            await next(context);
        }
        catch (ApiException error) { await ErrorAsync(context, error); }
        catch (CommandConflictException error) { await ErrorAsync(context, new ApiException(409, error.Code, "The account changed. Refresh and review before resubmitting.", version: error.StreamVersion)); }
        catch (OwnerAuthenticationException) { await ErrorAsync(context, new ApiException(401, "unauthenticated", "Sign in to continue.")); }
        catch (JsonException) { await ErrorAsync(context, new ApiException(400, "malformed_request", "Request JSON is invalid.")); }
        catch (BadHttpRequestException error) { await ErrorAsync(context, new ApiException(error.StatusCode, error.StatusCode == 413 ? "request_too_large" : "malformed_request", "Request is invalid.")); }
        catch (TimeoutException)
        {
            LogStorageFailure("StorageLockTimeout", context);
            await Unavailable(context, "lock_timeout");
        }
        catch (InvalidDataException)
        {
            LogStorageFailure("EventStreamUnreadable", context);
            await Unavailable(context, "stream_unreadable");
        }
        catch (UnauthorizedAccessException)
        {
            LogStorageFailure("StorageUnavailable", context);
            await Unavailable(context, "storage_unavailable");
        }
        catch (IOException)
        {
            LogStorageFailure("StorageUnavailable", context);
            await Unavailable(context, "storage_unavailable");
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested) { }
        catch (Exception error)
        {
            logger.LogError("Request failure {ErrorClass} {CorrelationId}", error.GetType().Name, context.TraceIdentifier);
            await ErrorAsync(context, new ApiException(500, "server_error", "The request could not be completed."));
        }
    }

    private void LogStorageFailure(string failureClass, HttpContext context) =>
        logger.LogWarning(new EventId(5300, failureClass),
            "Storage failure {StorageFailureClass} {CorrelationId}", failureClass, context.TraceIdentifier);

    private static Task Unavailable(HttpContext context, string code)
    {
        context.Response.Headers.RetryAfter = "1";
        return ErrorAsync(context, new ApiException(503, code, "Storage is unavailable. Retry with the same command key."));
    }

    public static (Guid Key, long ExpectedVersion) ReadCommand(HttpRequest request)
    {
        var key = request.Headers["Idempotency-Key"];
        var version = request.Headers.IfMatch;
        if (key.Count != 1 || !Guid.TryParseExact(key[0], "D", out var parsedKey) || version.Count != 1 ||
            !Regex.IsMatch(version[0] ?? "", "\\A\"(0|[1-9][0-9]*)\"\\z", RegexOptions.CultureInvariant) ||
            !long.TryParse(version[0]![1..^1], NumberStyles.None, CultureInfo.InvariantCulture, out var parsedVersion) || parsedVersion > 9007199254740991)
            throw new ApiException(400, "invalid_header", "A UUID Idempotency-Key and quoted nonnegative If-Match version are required.");
        return (parsedKey, parsedVersion);
    }

    public static async Task<T> ReadBodyAsync<T>(HttpRequest request, CancellationToken cancellationToken = default)
    {
        var bytes = await ReadBoundedAsync(request, cancellationToken);
        using var document = JsonDocument.Parse(bytes);
        EventSerializer.RejectDuplicates(document.RootElement);
        return document.RootElement.Deserialize<T>(JsonOptions) ?? throw new JsonException("Request body is required.");
    }

    private static async Task<byte[]> ReadBoundedAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        if (request.ContentLength > MaximumBodyBytes) throw new ApiException(413, "request_too_large", "Request exceeds 64 KiB.");
        using var buffer = new MemoryStream();
        var bytes = new byte[8192];
        int count;
        while ((count = await request.Body.ReadAsync(bytes.AsMemory(0, Math.Min(bytes.Length, MaximumBodyBytes + 1 - (int)buffer.Length)), cancellationToken)) > 0)
        {
            buffer.Write(bytes, 0, count);
            if (buffer.Length > MaximumBodyBytes) throw new ApiException(413, "request_too_large", "Request exceeds 64 KiB.");
        }
        return buffer.ToArray();
    }

    public static Task WriteAsync(HttpContext context, int status, object body, long? version = null)
    {
        context.Response.StatusCode = status;
        if (version.HasValue) context.Response.Headers.ETag = $"\"{version.Value}\"";
        return context.Response.WriteAsJsonAsync(body, JsonOptions, context.RequestAborted);
    }

    internal static Task ErrorAsync(HttpContext context, ApiException error, CancellationToken cancellationToken = default)
    {
        context.Response.StatusCode = error.StatusCode;
        var body = new ApiError(error.Code, error.StatusCode == 404 ? "Resource unavailable." : error.Message,
            context.TraceIdentifier,
            error.Field is null ? null : [new ApiErrorDetail(error.Field, error.Message)], error.StreamVersion);
        return context.Response.WriteAsJsonAsync(body, JsonOptions, cancellationToken);
    }

    public static int ListLimit(string? value)
    {
        if (value is null) return 50;
        if (!int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var limit) || limit < 1 || limit > 200)
            throw new ApiException(400, "malformed_request", "List limit must be between 1 and 200.", "limit");
        return limit;
    }
}

internal sealed class StrictEnumConverterFactory : JsonConverterFactory
{
    public override bool CanConvert(Type typeToConvert) => typeToConvert.IsEnum;
    public override JsonConverter CreateConverter(Type typeToConvert, JsonSerializerOptions options) =>
        (JsonConverter)Activator.CreateInstance(typeof(StrictEnumConverter<>).MakeGenericType(typeToConvert))!;
}

internal sealed class StrictEnumConverter<T> : JsonConverter<T> where T : struct, Enum
{
    public override T Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType != JsonTokenType.String || !Enum.TryParse<T>(reader.GetString(), false, out var value) ||
            !Enum.IsDefined(value) || value.ToString() != reader.GetString()) throw new JsonException("Invalid enum value.");
        return value;
    }
    public override void Write(Utf8JsonWriter writer, T value, JsonSerializerOptions options) => writer.WriteStringValue(value.ToString());
}
