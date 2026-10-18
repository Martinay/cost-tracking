using System.Text.Json.Serialization;

namespace CostTracking.Api.Domain;

[JsonConverter(typeof(JsonStringEnumConverter<TaskType>))]
public enum TaskType { Riding, Groundwork, Lunging, Grooming, MedicalCare, PaddockDuty, Transportation, Other }

public sealed record HorseTask
{
    public Guid TaskId { get; }
    public Guid HorseId { get; }
    public DateOnly TaskDate { get; }
    public TaskType TaskType { get; }
    public long Minutes { get; }
    public decimal? Quantity { get; }
    public string? QuantityUnit { get; }
    public string Notes { get; }
    public long StreamVersion { get; }

    private HorseTask(Guid taskId, Guid horseId, DateOnly taskDate, TaskType taskType, long minutes,
        decimal? quantity, string? quantityUnit, string notes, long streamVersion)
    {
        TaskId = taskId;
        HorseId = horseId;
        TaskDate = taskDate;
        TaskType = taskType;
        Minutes = minutes;
        Quantity = quantity;
        QuantityUnit = quantityUnit;
        Notes = notes;
        StreamVersion = streamVersion;
    }

    public static HorseTask Create(Guid taskId, Horse horse, DateOnly taskDate, TaskType taskType, long minutes,
        decimal? quantity, string? quantityUnit, string notes, long streamVersion)
    {
        ArgumentNullException.ThrowIfNull(horse);
        if (horse.HorseId == Guid.Empty) throw new ArgumentException("Horse ID cannot be empty.", nameof(horse));
        if (horse.Status is not (HorseStatus.Active or HorseStatus.Leased))
            throw new ArgumentException("Tasks can only be logged for Active or Leased horses.", nameof(horse));
        return CreateValidated(taskId, horse.HorseId, taskDate, taskType, minutes, quantity, quantityUnit, notes, streamVersion);
    }

    internal static HorseTask FromEvent(Guid taskId, Guid horseId, DateOnly taskDate, TaskType taskType, long minutes,
        decimal? quantity, string? quantityUnit, string notes, long streamVersion) =>
        CreateValidated(taskId, horseId, taskDate, taskType, minutes, quantity, quantityUnit, notes, streamVersion);

    private static HorseTask CreateValidated(Guid taskId, Guid horseId, DateOnly taskDate, TaskType taskType, long minutes,
        decimal? quantity, string? quantityUnit, string notes, long streamVersion)
    {
        if (taskId == Guid.Empty) throw new ArgumentException("Task ID cannot be empty.", nameof(taskId));
        if (horseId == Guid.Empty) throw new ArgumentException("Horse ID cannot be empty.", nameof(horseId));
        if (!Enum.IsDefined(taskType)) throw new ArgumentOutOfRangeException(nameof(taskType));
        if (minutes < 0 || minutes > FinancialValues.MaximumSafeInteger)
            throw new ArgumentOutOfRangeException(nameof(minutes), "Minutes must be a nonnegative safe integer.");
        if (quantity is < 0) throw new ArgumentOutOfRangeException(nameof(quantity), "Quantity must be positive when provided.");
        if ((quantity.HasValue && string.IsNullOrWhiteSpace(quantityUnit)) || (!quantity.HasValue && quantityUnit is not null))
            throw new ArgumentException("Quantity and a nonempty unit must be provided together.", nameof(quantityUnit));
        if (quantityUnit is { } unit && (unit.Length > 30 || unit != unit.Trim()))
            throw new ArgumentOutOfRangeException(nameof(quantityUnit), "Quantity unit must be trimmed and at most 30 characters.");
        if (quantity is not > 0 && minutes == 0)
            throw new ArgumentException("Task effort requires positive minutes or positive quantity.");
        ArgumentNullException.ThrowIfNull(notes);
        if (notes.Length > 1000) throw new ArgumentOutOfRangeException(nameof(notes));
        if (streamVersion < 1) throw new ArgumentOutOfRangeException(nameof(streamVersion));
        return new HorseTask(taskId, horseId, taskDate, taskType, minutes, quantity, quantityUnit, notes, streamVersion);
    }
}

public static class HorseTaskProjection
{
    private static readonly HashSet<string> ExpectedPayloadFields = new(StringComparer.Ordinal)
        { "taskId", "horseId", "taskDate", "taskType", "minutes", "quantity", "quantityUnit", "notes" };

    public static IReadOnlyList<HorseTask> Replay(IEnumerable<EventEnvelope> events)
    {
        ArgumentNullException.ThrowIfNull(events);
        var tasks = new List<HorseTask>();
        var taskIds = new HashSet<Guid>();
        var streamVersions = new HashSet<long>();
        foreach (var value in events)
        {
            if (value.Type != "TaskLogged") continue;
            try
            {
                var names = new HashSet<string>(StringComparer.Ordinal);
                foreach (var property in value.Payload.EnumerateObject())
                    if (!names.Add(property.Name)) throw new InvalidDataException("Task payload contains duplicate fields.");
                if (!names.SetEquals(ExpectedPayloadFields)) throw new InvalidDataException("Task payload fields do not match the canonical schema.");

                var payload = value.Payload;
                var taskId = payload.GetProperty("taskId").GetGuid();
                var horseId = payload.GetProperty("horseId").GetGuid();
                var dateText = payload.GetProperty("taskDate").GetString()!;
                var taskDate = DateOnly.ParseExact(dateText, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
                var typeText = payload.GetProperty("taskType").GetString()!;
                if (!Enum.TryParse<TaskType>(typeText, false, out var taskType) || !Enum.IsDefined(taskType) || taskType.ToString() != typeText)
                    throw new InvalidDataException("Task type is invalid.");
                var minutes = payload.GetProperty("minutes").GetInt64();
                var quantityElement = payload.GetProperty("quantity");
                decimal? quantity = quantityElement.ValueKind == System.Text.Json.JsonValueKind.Null ? null : quantityElement.GetDecimal();
                var unitElement = payload.GetProperty("quantityUnit");
                var unit = unitElement.ValueKind == System.Text.Json.JsonValueKind.Null ? null : unitElement.GetString();
                var notes = payload.GetProperty("notes").GetString()!;
                var task = HorseTask.FromEvent(taskId, horseId, taskDate, taskType, minutes, quantity, unit, notes, value.StreamVersion);
                if (!taskIds.Add(task.TaskId)) throw new InvalidDataException("Task ID is duplicated in the event stream.");
                if (!streamVersions.Add(task.StreamVersion)) throw new InvalidDataException("Task stream version is duplicated.");
                tasks.Add(task);
            }
            catch (InvalidDataException) { throw; }
            catch (Exception exception) when (exception is ArgumentException or FormatException or InvalidOperationException or System.Text.Json.JsonException)
            {
                throw new InvalidDataException("Task event payload is invalid.", exception);
            }
        }

        return tasks.OrderBy(task => task.TaskDate)
            .ThenBy(task => task.TaskId.ToString("D").ToLowerInvariant(), StringComparer.Ordinal).ToArray();
    }
}
