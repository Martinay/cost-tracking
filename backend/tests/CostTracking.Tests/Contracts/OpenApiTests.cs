using System.Net;
using System.Text.Json;
using CostTracking.Tests.Fixtures;

namespace CostTracking.Tests.Contracts;

public class OpenApiTests
{
    [Fact]
    public async Task Test_host_can_export_the_typed_api_document()
    {
        using var app = new TestApplication();
        var response = await app.CreateClient().GetAsync("/openapi/v1.json");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.StartsWith("3.", document.RootElement.GetProperty("openapi").GetString());
        Assert.Equal(JsonValueKind.Object, document.RootElement.GetProperty("paths").ValueKind);
        var schemas = document.RootElement.GetProperty("components").GetProperty("schemas");
        Assert.True(schemas.TryGetProperty("ApiError", out var errorSchema));
        Assert.Equal(JsonValueKind.Array, errorSchema.GetProperty("required").ValueKind);
        Assert.Equal(JsonValueKind.Object, errorSchema.GetProperty("properties").ValueKind);
        var properties = errorSchema.GetProperty("properties");
        Assert.Equal("string", properties.GetProperty("code").GetProperty("type").GetString());
        Assert.Equal("string", properties.GetProperty("correlationId").GetProperty("type").GetString());
        var details = properties.GetProperty("details").GetRawText();
        Assert.Contains("\"array\"", details, StringComparison.Ordinal);
        Assert.Contains("field", details, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Financial_and_activity_operations_publish_generated_json_request_and_response_schemas()
    {
        using var app = new TestApplication();
        using var response = await app.CreateClient().GetAsync("/openapi/v1.json");
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var paths = document.RootElement.GetProperty("paths");
        AssertOperation(paths, "/api/v1/expenses", "post", "CreateExpenseRequest", "201", "CreatedExpenseResponse");
        AssertOperation(paths, "/api/v1/income", "post", "CreateIncomeRequest", "201", "CreatedIncomeResponse");
        AssertOperation(paths, "/api/v1/previews/financial", "post", "FinancialPreviewRequest", "200", "FinancialPreviewResponse");
        var previewRequest = document.RootElement.GetProperty("components").GetProperty("schemas")
            .GetProperty("FinancialPreviewRequest");
        Assert.DoesNotContain("exampleOccurrence", previewRequest.GetProperty("required").EnumerateArray()
            .Select(item => item.GetString()));
        Assert.Equal("boolean", previewRequest.GetProperty("properties").GetProperty("exampleOccurrence")
            .GetProperty("type").GetString());
        AssertOperation(paths, "/api/v1/reports/monthly-pnl", "get", null, "200", "MonthlyReportResponse");
        AssertOperation(paths, "/api/v1/reports/lifetime", "get", null, "200", "LifetimeReportResponse");
        AssertOperation(paths, "/api/v1/reports/breakdown", "get", null, "200", "BreakdownReportResponse");
        AssertOperation(paths, "/api/v1/tasks", "post", "CreateTaskRequest", "201", "CreatedTaskResponse");
        AssertOperation(paths, "/api/v1/reports/activity", "get", null, "200", "ActivityReportResponse");
        AssertOperation(paths, "/api/v1/driving-rate", "put", "SetDrivingRateRequest", "200", "DrivingRateResponse");
        AssertOperation(paths, "/api/v1/driving", "post", "CreateDrivingRequest", "201", "CreatedDrivingResponse");
        AssertOperation(paths, "/api/v1/expense-rules", "post", "CreateExpenseRuleRequest", "201", "ExpenseRuleCommandResponse");
        AssertOperation(paths, "/api/v1/expense-rules", "get", null, "200", "ExpenseRuleListResponse");
        AssertOperation(paths, "/api/v1/income-rules", "post", "CreateIncomeRuleRequest", "201", "IncomeRuleCommandResponse");
        AssertOperation(paths, "/api/v1/income-rules", "get", null, "200", "IncomeRuleListResponse");
        AssertOperation(paths, "/api/v1/income-approvals", "get", null, "200", "IncomeApprovalListResponse");
        AssertOperation(paths, "/api/v1/income-rules/{ruleId}/occurrences/{scheduledDate}/approve", "post", "ApproveIncomeRequest", "200", "IncomeApprovalResponse");
        AssertOperation(paths, "/api/v1/expense-rules/{ruleId}/occurrences/{scheduledDate}", "put", "OverrideExpenseOccurrenceRequest", "200", "ExpenseOccurrenceCommandResponse");
        var taskType = document.RootElement.GetProperty("components").GetProperty("schemas").GetProperty("TaskType");
        AssertStringEnum(taskType, "Riding", "Groundwork", "Lunging", "Grooming", "MedicalCare", "PaddockDuty", "Transportation", "Other");

        var cadence = document.RootElement.GetProperty("components").GetProperty("schemas").GetProperty("Cadence");
        AssertStringEnum(cadence, "Daily", "Weekly", "Weekdays", "Monthly");

        var horseStatus = document.RootElement.GetProperty("components").GetProperty("schemas").GetProperty("HorseStatus");
        AssertStringEnum(horseStatus, "Active", "Leased", "Retired", "Sold");

        var splitMode = document.RootElement.GetProperty("components").GetProperty("schemas").GetProperty("SplitMode");
        AssertStringEnum(splitMode, "Equal", "Custom");

        var horseTask = document.RootElement.GetProperty("components").GetProperty("schemas").GetProperty("TaskListItem");
        Assert.Equal(new[] { "taskId", "horseId", "taskDate", "taskType", "minutes", "quantity", "quantityUnit", "notes", "streamVersion" },
            horseTask.GetProperty("required").EnumerateArray().Select(item => item.GetString()));
    }

    private static void AssertOperation(JsonElement paths, string path, string method, string? requestSchema,
        string responseCode, string responseSchema)
    {
        var operation = paths.GetProperty(path).GetProperty(method);
        if (requestSchema is not null)
        {
            var actualRequest = operation.GetProperty("requestBody").GetProperty("content")
                .GetProperty("application/json").GetProperty("schema").GetProperty("$ref").GetString();
            Assert.EndsWith($"/schemas/{requestSchema}", actualRequest, StringComparison.Ordinal);
        }
        var actualResponse = operation.GetProperty("responses").GetProperty(responseCode).GetProperty("content")
            .GetProperty("application/json").GetProperty("schema").GetProperty("$ref").GetString();
        Assert.EndsWith($"/schemas/{responseSchema}", actualResponse, StringComparison.Ordinal);
    }

    private static void AssertStringEnum(JsonElement schema, params string[] values)
    {
        if (schema.TryGetProperty("type", out var type)) Assert.Equal("string", type.GetString());
        Assert.Equal(values, schema.GetProperty("enum").EnumerateArray().Select(item => item.GetString()));
    }
}
