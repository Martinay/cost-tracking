targetScope = 'resourceGroup'

@minLength(3)
@maxLength(30)
param namePrefix string

@allowed(['centralindia'])
param location string = 'centralindia'
@description('Static Web Apps does not support Central India; its static content is globally distributed.')
@allowed(['westus2', 'centralus', 'eastus2', 'westeurope', 'eastasia'])
param staticWebAppLocation string = 'westeurope'
@description('Stable storage account name derived from the resource group. Preserve this name after data is written.')
param storageAccountName string = 'ct${uniqueString(resourceGroup().id)}'
param fileShareName string = 'ledger'
@minValue(1)
@maxValue(5120)
@description('Azure Files share quota in GiB.')
param fileShareQuotaGiB int = 10
@description('Immutable OCI image reference pinned by digest, for example ghcr.io/owner/repository/api@sha256:<64 hex characters>.')
param apiImage string
param appDomain string
param apiDomain string
@description('Set true only after both DNS names resolve to their Azure endpoints. First deployment should leave this false.')
param enableCustomDomains bool = false
@minValue(0)
@maxValue(1)
@description('Minimum API replicas. Setting this to 1 keeps a replica warm while managed-certificate validation runs; confirm scale-to-zero behavior and certificate renewal in Azure.')
param apiMinReplicas int = 0
@description('GitHub account with read access to the private GHCR package.')
param ghcrUsername string
@secure()
@description('Classic GitHub personal access token with read:packages for runtime image pulls.')
param ghcrToken string
param workOsClientId string
@secure()
param workOsApiKey string
param authIssuer string
param authAudience string
param authJwksUrl string
param operationsEmail string
param fileCapacityAlertBytes int = 8589934592

var environmentName = '${namePrefix}-env'
var apiAppName = '${namePrefix}-api'
var staticAppName = '${namePrefix}-web'
var logWorkspaceName = '${namePrefix}-logs'
var dataProtectionVaultName = 'kv${uniqueString(subscription().id, resourceGroup().id, namePrefix)}'
var dataProtectionKeyName = 'data-protection'
var keyVaultCryptoServiceEncryptionUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'e147488a-f6f5-4113-8e2d-b22465e65bf6')
var allowedMountOptions = 'vers=3.0,uid=1654,gid=1654,file_mode=0660,dir_mode=0770'

resource dataProtectionVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: dataProtectionVaultName
  location: location
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
    accessPolicies: []
  }
}

resource dataProtectionKey 'Microsoft.KeyVault/vaults/keys@2023-07-01' = {
  parent: dataProtectionVault
  name: dataProtectionKeyName
  properties: {
    attributes: {
      enabled: true
    }
    kty: 'RSA'
    keySize: 2048
    keyOps: [
      'wrapKey'
      'unwrapKey'
    ]
    rotationPolicy: {
      lifetimeActions: [
        {
          trigger: {
            timeAfterCreate: 'P1Y'
          }
          action: {
            type: 'rotate'
          }
        }
      ]
    }
  }
}

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true
  }
}

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    shareDeleteRetentionPolicy: {
      enabled: true
      days: 7
    }
  }
}

resource fileShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  parent: fileService
  name: fileShareName
  properties: {
    enabledProtocols: 'SMB'
    accessTier: 'TransactionOptimized'
    shareQuota: fileShareQuotaGiB
  }
}

resource logWorkspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logWorkspaceName
  location: location
  properties: {
    retentionInDays: 30
    sku: {
      name: 'PerGB2018'
    }
    workspaceCapping: {
      dailyQuotaGb: 1
    }
  }
}

resource appEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logWorkspace.properties.customerId
        sharedKey: logWorkspace.listKeys().primarySharedKey
      }
    }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}

resource environmentFileLink 'Microsoft.App/managedEnvironments/storages@2024-08-02-preview' = {
  parent: appEnvironment
  name: 'ledger-files'
  properties: {
    azureFile: {
      accessMode: 'ReadWrite'
      accountKey: storageAccount.listKeys().keys[0].value
      accountName: storageAccount.name
      shareName: fileShare.name
    }
  }
}

resource apiCertificate 'Microsoft.App/managedEnvironments/managedCertificates@2024-03-01' = if (enableCustomDomains) {
  parent: appEnvironment
  name: 'api-host-certificate'
  location: location
  properties: {
    domainControlValidation: 'CNAME'
    subjectName: apiDomain
  }
}

resource apiApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: apiAppName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: appEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [
        {
          server: 'ghcr.io'
          username: ghcrUsername
          passwordSecretRef: 'ghcr-token'
        }
      ]
      secrets: [
        {
          name: 'ghcr-token'
          value: ghcrToken
        }
        {
          name: 'workos-api-key'
          value: workOsApiKey
        }
      ]
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
        customDomains: enableCustomDomains ? [
          {
            name: apiDomain
            bindingType: 'SniEnabled'
            certificateId: apiCertificate.id
          }
        ] : []
      }
    }
    template: {
      containers: [
        {
          name: 'cost-tracking-api'
          image: apiImage
          env: [
            { name: 'WorkOS__ClientId', value: workOsClientId }
            { name: 'WorkOS__ApiKey', secretRef: 'workos-api-key' }
            { name: 'Auth__Issuer', value: authIssuer }
            { name: 'Auth__Audience', value: authAudience }
            { name: 'Auth__JwksUrl', value: authJwksUrl }
            { name: 'Auth__FrontendOrigin', value: 'https://${appDomain}' }
            { name: 'Auth__CallbackUrl', value: 'https://${apiDomain}/auth/callback' }
            { name: 'Auth__DataProtectionKeyIdentifier', value: join(take(split(dataProtectionKey.properties.keyUri, '/'), 5), '/') }
            { name: 'Auth__DataProtectionKeyPath', value: '/data/auth/keys' }
            { name: 'Cors__AllowedOrigin', value: 'https://${appDomain}' }
            { name: 'Storage__Root', value: '/data' }
            { name: 'ASPNETCORE_ENVIRONMENT', value: 'Production' }
            { name: 'ASPNETCORE_HTTP_PORTS', value: '8080' }
          ]
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          volumeMounts: [
            {
              volumeName: 'ledger-data'
              mountPath: '/data'
            }
          ]
          probes: [
            {
              type: 'Liveness'
              tcpSocket: {
                port: 8080
              }
              initialDelaySeconds: 10
              periodSeconds: 30
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: apiMinReplicas
        maxReplicas: 1
      }
      volumes: [
        {
          name: 'ledger-data'
          storageType: 'AzureFile'
          storageName: environmentFileLink.name
          mountOptions: allowedMountOptions
        }
      ]
    }
  }
}

resource dataProtectionKeyAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(dataProtectionKey.id, apiApp.name, keyVaultCryptoServiceEncryptionUserRoleId)
  scope: dataProtectionKey
  properties: {
    roleDefinitionId: keyVaultCryptoServiceEncryptionUserRoleId
    principalId: apiApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource staticWebApp 'Microsoft.Web/staticSites@2022-09-01' = {
  name: staticAppName
  location: staticWebAppLocation
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {}
}

resource staticWebDomain 'Microsoft.Web/staticSites/customDomains@2022-09-01' = if (enableCustomDomains) {
  parent: staticWebApp
  name: appDomain
  properties: {
    validationMethod: 'cname-delegation'
  }
}

resource operationsActionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: '${namePrefix}-ops'
  location: 'global'
  properties: {
    groupShortName: 'costops'
    enabled: true
    emailReceivers: [
      {
        name: 'operator'
        emailAddress: operationsEmail
        useCommonAlertSchema: true
      }
    ]
    smsReceivers: []
    webhookReceivers: []
  }
}

resource storageCapacityAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${namePrefix}-files-capacity'
  location: 'global'
  properties: {
    description: 'Azure Files capacity has crossed the operator configured threshold.'
    severity: 2
    enabled: true
    evaluationFrequency: 'PT1H'
    windowSize: 'PT6H'
    scopes: [
      fileService.id
    ]
    targetResourceType: 'Microsoft.Storage/storageAccounts/fileServices'
    targetResourceRegion: location
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'FileCapacity'
          metricNamespace: 'Microsoft.Storage/storageAccounts/fileServices'
          metricName: 'FileCapacity'
          operator: 'GreaterThan'
          threshold: fileCapacityAlertBytes
          timeAggregation: 'Average'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [
      {
        actionGroupId: operationsActionGroup.id
        webHookProperties: {
          alertClass: 'storage-capacity'
          payloadPolicy: 'no-ledger-data'
        }
      }
    ]
  }
}

resource safeStorageFailureAlert 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: '${namePrefix}-storage-failures'
  location: location
  kind: 'LogAlert'
  properties: {
    displayName: 'Cost tracking storage failure class'
    description: 'Counts only fixed storage failure classifications; query results contain no request or ledger fields.'
    enabled: true
    severity: 2
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    autoMitigate: true
    skipQueryValidation: true
    scopes: [
      logWorkspace.id
    ]
    criteria: {
      allOf: [
        {
          query: '''ContainerAppConsoleLogs_CL
| where Log_s has_any ("StorageLockTimeout", "EventStreamUnreadable", "EventReplayFailure", "EventAppendFailure", "StorageUnavailable", "ProjectionSnapshotFailure")
| summarize FailureCount = count()
'''
          timeAggregation: 'Count'
          metricMeasureColumn: 'FailureCount'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: [
        operationsActionGroup.id
      ]
      customProperties: {
        alertClass: 'storage-failure'
        payloadPolicy: 'aggregate-count-only'
      }
    }
  }
}

output apiUrl string = 'https://${apiDomain}'
output frontendUrl string = 'https://${appDomain}'
output staticWebAppDefaultHostname string = staticWebApp.properties.defaultHostname
output apiDefaultHostname string = apiApp.properties.configuration.ingress.fqdn
output apiDomainVerificationId string = apiApp.properties.customDomainVerificationId
output logAnalyticsWorkspaceId string = logWorkspace.id
output storageShareId string = fileShare.id
