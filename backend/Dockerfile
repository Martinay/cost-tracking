FROM mcr.microsoft.com/dotnet/sdk:10.0.103 AS build
WORKDIR /src

COPY backend/Directory.Build.props backend/Directory.Build.props
COPY backend/src/CostTracking.Api/CostTracking.Api.csproj backend/src/CostTracking.Api/packages.lock.json backend/src/CostTracking.Api/
COPY specs/001-horse-finance-effort-tracking/contracts/events-v1.schema.json specs/001-horse-finance-effort-tracking/contracts/events-v1.schema.json
RUN dotnet restore backend/src/CostTracking.Api/CostTracking.Api.csproj --locked-mode

COPY backend/src/CostTracking.Api/ backend/src/CostTracking.Api/
RUN dotnet publish backend/src/CostTracking.Api/CostTracking.Api.csproj \
    --configuration Release \
    --no-restore \
    --output /out \
    -p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0.3 AS runtime
WORKDIR /app
ENV ASPNETCORE_HTTP_PORTS=8080 \
    ASPNETCORE_ENVIRONMENT=Production

COPY --from=build --chown=1654:1654 /out/ ./
USER app
EXPOSE 8080

ENTRYPOINT ["dotnet", "CostTracking.Api.dll"]
