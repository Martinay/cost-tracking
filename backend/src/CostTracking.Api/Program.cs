using CostTracking.Api.Auth;
using CostTracking.Api.Contracts;
using CostTracking.Api.Storage;
using CostTracking.Api.Features.Account;
using CostTracking.Api.Features.Horses;
using CostTracking.Api.Features.History;
using CostTracking.Api.Features.Expenses;
using CostTracking.Api.Features.Income;
using CostTracking.Api.Features.Previews;
using CostTracking.Api.Features.Reports;
using CostTracking.Api.Features.Tasks;
using CostTracking.Api.Features.Driving;
using CostTracking.Api.Features.ExpenseRules;
using CostTracking.Api.Features.IncomeRules;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Authentication.JwtBearer;
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<Func<Guid>>(() => Guid.NewGuid());
builder.Services.AddOwnerAuthentication();
builder.Services.AddOpenApi(options => options.AddDocumentTransformer<ApiErrorSchemaTransformer>());
builder.Services.AddApiProtocol(builder.Configuration);
var storageRoot = builder.Configuration["Storage:Root"] ?? "./data";
var keyRingPath = builder.Configuration["Auth:DataProtectionKeyPath"] ?? Path.Combine(storageRoot, "auth", "keys");
if (builder.Environment.IsProduction()) JwtAuthentication.ValidateConfiguration(builder.Configuration);
DataProtectionKeyRing.Configure(builder.Services, builder.Configuration, builder.Environment.IsProduction(), keyRingPath);
builder.Services.AddSingleton<SubjectLock>();
builder.Services.AddSingleton(serviceProvider => new JsonlEventStore(
    serviceProvider.GetRequiredService<IConfiguration>()["Storage:Root"] ?? storageRoot,
    serviceProvider.GetRequiredService<SubjectLock>()));
builder.Services.AddSingleton(serviceProvider => new SessionStore(
    serviceProvider.GetRequiredService<IConfiguration>() ["Storage:Root"] ?? storageRoot,
    serviceProvider.GetRequiredService<IDataProtectionProvider>(), serviceProvider.GetRequiredService<SubjectLock>()));
builder.Services.AddHttpClient<IWorkOsClient, WorkOsClient>(client =>
{
    var address = builder.Configuration["WorkOS:ApiBaseUrl"] ?? "https://api.workos.com/";
    if (!Uri.TryCreate(address, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
        throw new InvalidOperationException("WorkOS:ApiBaseUrl must be HTTPS.");
    client.BaseAddress = uri;
    client.Timeout = TimeSpan.FromSeconds(10);
});
builder.Services.AddSingleton<SessionTokenValidator>();
if (builder.Environment.IsProduction())
{
    builder.Services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
        .Configure<IConfiguration>((_, configuration) =>
        {
            if (string.IsNullOrWhiteSpace(configuration["WorkOS:ClientId"]) || string.IsNullOrWhiteSpace(configuration["WorkOS:ApiKey"]))
                throw new InvalidOperationException("Production requires WorkOS:ClientId and WorkOS:ApiKey.");
        });
}
builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);
var app = builder.Build();
if (!app.Environment.IsProduction()) app.MapOpenApi();
app.UseAuthentication();
app.UseApiProtocol();
app.UseAuthorization();
app.MapSessionBroker();
app.MapAccountEndpoints();
app.MapHorseEndpoints();
app.MapHistoryEndpoints();
app.MapExpenseEndpoints();
app.MapIncomeEndpoints();
app.MapFinancialPreviewEndpoints();
app.MapFinancialReportEndpoints();
app.MapBreakdownReportEndpoints();
app.MapTaskEndpoints();
app.MapActivityReportEndpoints();
app.MapDrivingEndpoints();
app.MapExpenseRuleEndpoints();
app.MapExpenseOccurrenceEndpoints();
app.MapIncomeRuleEndpoints();
app.MapIncomeApprovalEndpoints();
app.Run();

public partial class Program;
