using System.Globalization;
using CostTracking.Api.Auth;
using CostTracking.Api.Contracts;
using CostTracking.Api.Domain;
using CostTracking.Api.Features.Account;
using CostTracking.Api.Features.Expenses;
using CostTracking.Api.Storage;

namespace CostTracking.Api.Features.Tasks;

public static class TaskEndpoints
{
    public static IEndpointRouteBuilder MapTaskEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/v1/tasks", CreateAsync)
            .Accepts<CreateTaskRequest>("application/json")
            .Produces<CreatedTaskResponse>(StatusCodes.Status201Created, "application/json");
        endpoints.MapGet("/api/v1/tasks", ListAsync)
            .Produces<TaskListResponse>(StatusCodes.Status200OK, "application/json");
        return endpoints;
    }

    private static async Task<IResult> CreateAsync(HttpContext context, JsonlEventStore store, TimeProvider clock,
        Func<Guid> newId, CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var request = await ApiProtocol.ReadBodyAsync<CreateTaskRequest>(context.Request, cancellationToken);
        var command = AccountEndpoints.Command(context, "POST", "/api/v1/tasks", request);
        var pipeline = new CommandPipeline(store, clock, newId);
        var result = await pipeline.ExecuteAsync(owner, command, events =>
        {
            var horse = HorseProjection.Replay(events).FirstOrDefault(item => item.HorseId == request.HorseId)
                ?? throw FinancialEndpointSupport.NotFound();
            var account = AccountProjection.Replay(owner, events);
            if (request.TaskDate > FinancialEndpointSupport.OwnerToday(clock, account.TimeZone))
                throw FinancialEndpointSupport.Error(422, "future_task_date", "Task date cannot be after today.", "taskDate");

            HorseTask task;
            try
            {
                task = HorseTask.Create(newId(), horse, request.TaskDate, request.TaskType, request.Minutes,
                    request.Quantity, request.QuantityUnit, request.Notes, checked(events.Count + 1));
            }
            catch (ArgumentException exception) when (exception.ParamName == "horse")
            {
                throw FinancialEndpointSupport.Error(422, "inactive_horse", "Tasks can only be logged for an Active or Leased horse.", "horseId");
            }
            catch (ArgumentException)
            {
                throw FinancialEndpointSupport.Error(422, "invalid_task", "Task effort, quantity, unit or notes are invalid.", "task");
            }

            return AccountEndpoints.Event("TaskLogged", new
            {
                task.TaskId,
                task.HorseId,
                taskDate = task.TaskDate,
                taskType = task.TaskType.ToString(),
                task.Minutes,
                task.Quantity,
                task.QuantityUnit,
                task.Notes
            });
        }, (accepted, _) => AccountEndpoints.CreatedResponse(accepted.StreamVersion,
            new { taskId = accepted.Payload.GetProperty("taskId").GetGuid(), streamVersion = accepted.StreamVersion }), cancellationToken);
        return await AccountEndpoints.WriteAsync(context, result.StatusCode, result.Body, result.StreamVersion);
    }

    private static async Task<IResult> ListAsync(HttpContext context, JsonlEventStore store, CursorCodec cursorCodec,
        TimeProvider clock, CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var events = await store.ReadAsync(owner, cancellationToken);
        var account = AccountProjection.Replay(owner, events);
        var fromText = context.Request.Query["from"].FirstOrDefault();
        var throughText = context.Request.Query["to"].FirstOrDefault();
        if (fromText is null || throughText is null)
            throw FinancialEndpointSupport.Error(400, "malformed_request", "Both from and to dates are required.", "from");
        var from = FinancialEndpointSupport.ReadDate(fromText, "from");
        var through = FinancialEndpointSupport.ReadDate(throughText, "to");
        FinancialEndpointSupport.ValidateWindow(from, through);
        var horseId = FinancialEndpointSupport.ReadId(context.Request.Query["horseId"].FirstOrDefault(), "horseId");
        var typeText = context.Request.Query["taskType"].FirstOrDefault();
        var taskType = ParseTaskType(typeText);
        var limit = ApiProtocol.ListLimit(context.Request.Query["limit"].FirstOrDefault());
        var filter = $"from={from:yyyy-MM-dd};to={through:yyyy-MM-dd};horseId={FinancialEndpointSupport.Canonical(horseId)};taskType={typeText ?? "*"};limit={limit}";
        var today = FinancialEndpointSupport.OwnerToday(clock, account.TimeZone);
        var after = context.Request.Query["cursor"].FirstOrDefault() is { } cursor
            ? cursorCodec.Decode(cursor, owner, filter, account.StreamVersion, today)
            : null;
        if (after is not null && !IsTaskPosition(after))
            throw FinancialEndpointSupport.Error(400, "invalid_cursor", "Cursor position is invalid.");

        var horses = HorseProjection.Replay(events).ToDictionary(item => item.HorseId);
        if (horseId is { } selected && !horses.ContainsKey(selected)) throw FinancialEndpointSupport.NotFound();
        var matches = HorseTaskProjection.Replay(events).Where(item => item.TaskDate >= from && item.TaskDate <= through)
            .Where(item => horseId is null || item.HorseId == horseId.Value)
            .Where(item => taskType is null || item.TaskType == taskType.Value)
            .Where(item => after is null || StringComparer.Ordinal.Compare(TaskPosition(item), after) > 0)
            .ToArray();
        var page = matches.Take(limit + 1).ToArray();
        var hasMore = page.Length > limit;
        var tasks = page.Take(limit).ToArray();
        var items = tasks.Select(item => new TaskListItem(item.TaskId, item.HorseId, item.TaskDate, item.TaskType,
            item.Minutes, item.Quantity, item.QuantityUnit, item.Notes, item.StreamVersion)).ToArray();
        var nextCursor = hasMore ? cursorCodec.Encode(owner, filter, account.StreamVersion, today, TaskPosition(tasks[^1])) : null;
        return await AccountEndpoints.WriteAsync(context, 200,
            new { items, nextCursor, streamVersion = account.StreamVersion }, account.StreamVersion);
    }

    internal static TaskType? ParseTaskType(string? value)
    {
        if (value is null) return null;
        if (!Enum.TryParse<TaskType>(value, false, out var parsed) || !Enum.IsDefined(parsed) || parsed.ToString() != value)
            throw FinancialEndpointSupport.Error(400, "malformed_request", "Task type filter is invalid.", "taskType");
        return parsed;
    }

    internal static string TaskPosition(HorseTask task) =>
        $"{task.TaskDate:yyyy-MM-dd};{task.TaskId:D}".ToLowerInvariant();

    private static bool IsTaskPosition(string value)
    {
        var parts = value.Split(';');
        return parts.Length == 2 && DateOnly.TryParseExact(parts[0], "yyyy-MM-dd", CultureInfo.InvariantCulture,
            DateTimeStyles.None, out _) && Guid.TryParseExact(parts[1], "D", out _);
    }

    public sealed record CreateTaskRequest(Guid HorseId, DateOnly TaskDate, TaskType TaskType, long Minutes = 0,
        decimal? Quantity = null, string? QuantityUnit = null, string Notes = "");
    public sealed record CreatedTaskResponse(Guid TaskId, long StreamVersion);
    public sealed record TaskListItem(Guid TaskId, Guid HorseId, DateOnly TaskDate, TaskType TaskType, long Minutes,
        decimal? Quantity, string? QuantityUnit, string Notes, long StreamVersion);
    public sealed record TaskListResponse(IReadOnlyList<TaskListItem> Items, string? NextCursor, long StreamVersion);
}
