#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--container-client" ]]; then
  shift
  client_mode="${1:?container proof mode required}"
  shift
  work="$(mktemp -d /tmp/storage-proof.XXXXXX)"
  trap 'rm -rf "$work"' EXIT
  mkdir -p "$work/backend/src" "$work/backend/tools" "$work/backend/tests" "$work/specs/001-horse-finance-effort-tracking"
  cp /repo/backend/Directory.Build.props "$work/backend/Directory.Build.props"
  cp -R /repo/backend/src/CostTracking.Api "$work/backend/src/CostTracking.Api"
  cp -R /repo/backend/tools/StorageProof "$work/backend/tools/StorageProof"
  cp -R /repo/backend/tests/CostTracking.Tests "$work/backend/tests/CostTracking.Tests"
  cp -R /repo/backend/tests/CostTracking.TestHost "$work/backend/tests/CostTracking.TestHost"
  cp -R /repo/specs/001-horse-finance-effort-tracking/contracts "$work/specs/001-horse-finance-effort-tracking/contracts"
  cp /repo/global.json "$work/global.json"
  cd "$work"
  export DOTNET_CLI_HOME="$work/.dotnet"
  export NUGET_PACKAGES="$work/.nuget"
  export DOTNET_CLI_TELEMETRY_OPTOUT=1
  dotnet build backend/tools/StorageProof/StorageProof.csproj --configuration Release --disable-build-servers -m:1 -p:UseSharedCompilation=false
  case "$client_mode" in
    local)
      report_path="${1:-/out/storage-proof-early.md}"
      image_digest="${STORAGE_PROOF_IMAGE_DIGEST:-unreported}"
      dotnet backend/tools/StorageProof/bin/Release/net10.0/StorageProof.dll "$report_path" "$image_digest"
      export STORAGE_PROOF_REPORT_PATH="$report_path"
      dotnet test backend/tests/CostTracking.Tests/CostTracking.Tests.csproj --configuration Release --disable-build-servers -m:1 -p:UseSharedCompilation=false --filter Category=StorageProof
      ;;
    worker)
      dotnet backend/tools/StorageProof/bin/Release/net10.0/StorageProof.dll worker "$@"
      ;;
    azure-client)
      run_id="${STORAGE_PROOF_RUN_ID:?proof run id is required}"
      client_id="${STORAGE_PROOF_CLIENT_ID:?client id is required}"
      run_directory="/share/.cost-tracking-storage-proof/$run_id"
      dll="backend/tools/StorageProof/bin/Release/net10.0/StorageProof.dll"
      if [[ "$client_id" == "client-a" ]]; then
        version_key="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      else
        version_key="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      fi
      dotnet "$dll" worker race-command "$run_directory/version/data" user_StorageRace "version-$client_id" "$run_directory/version-result-${client_id#client-}.json" "$version_key" 0 '{"currency":"EUR","timeZone":"Europe/Berlin"}' "$run_directory/version/go"
      dotnet "$dll" worker race-command "$run_directory/same-key/data" user_StorageIdempotency "same-key-$client_id" "$run_directory/same-key-result-${client_id#client-}.json" cccccccc-cccc-4ccc-8ccc-cccccccccccc 0 '{"currency":"EUR","timeZone":"Europe/Berlin"}' "$run_directory/same-key/go"
      touch "$run_directory/$client_id.done"
      until test -f "$run_directory/verification-complete"; do sleep 0.1; done
      ;;
    azure-verify)
      export STORAGE_PROOF_AZURE_REPORT="${STORAGE_PROOF_AZURE_REPORT:-/report/storage-proof-early.md}"
      run_directory="${STORAGE_PROOF_AZURE_RUN_DIRECTORY:?Azure run directory is required}"
      attempt=0
      until test -f "$run_directory/client-a.done" && test -f "$run_directory/client-b.done"; do
        attempt=$((attempt + 1))
        test "$attempt" -lt 600 || { echo 'Timed out waiting for both SMB client proofs' >&2; exit 1; }
        sleep 0.1
      done
      dotnet test backend/tests/CostTracking.Tests/CostTracking.Tests.csproj --configuration Release --disable-build-servers -m:1 -p:UseSharedCompilation=false --filter Category=AzureSmb
      touch "$run_directory/verification-complete"
      ;;
    *)
      echo "Unsupported container proof mode: $client_mode" >&2
      exit 2
      ;;
  esac
  exit 0
fi

repo_root="$(git rev-parse --show-toplevel)"
image="${STORAGE_PROOF_IMAGE:-mcr.microsoft.com/dotnet/sdk:10.0.103}"
image_digest="$(docker image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{else}}{{.Id}}{{end}}' "$image")"
validation_dir="$repo_root/specs/001-horse-finance-effort-tracking/validation"

docker run --rm \
  --volume "$repo_root:/repo:ro" \
  --volume "$validation_dir:/out:rw" \
  --workdir /repo \
  --env STORAGE_PROOF_IMAGE_DIGEST="$image_digest" \
  "$image" \
  bash /repo/scripts/storage-proof.sh --container-client local /out/storage-proof-early.md
