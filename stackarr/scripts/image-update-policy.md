# Application release compatibility policy

Stackarr updates favor new features. The update pipeline checks **known** incompatibilities before pulling and then uses its existing per-service pull retry, scoped recreation, and health/readiness checks. An undocumented range is a warning, not a global freeze. Initial installation, same-image recovery, read-only commands, configuration apply, storage migration and ephemeral maintenance do not require release enrollment. This does not change the storage guard or authorize database/cache image upgrades; managed engine version changes remain a separate manual migration.

Optionally set `STACKARR_RELEASE_COMPATIBILITY_FILE` to an absolute regular JSON file on the updater's shared config/state mount (maximum 1 MiB). Keep entries keyed by **service and exact candidate image reference**, with actual release evidence, not guesses based on `latest` tags. Do not create empty fictional records to make a gate pass. Example _schema only_, not a claim about any real product's compatibility:

```json
{
  "services": {
    "service-name": {
      "releases": {
        "registry.example/app:VERSION@sha256:ACTUAL_DIGEST": {
          "image": "registry.example/app:VERSION@sha256:ACTUAL_DIGEST",
          "version": "VERSION",
          "previous": "registry.example/app:PREVIOUS@sha256:ACTUAL_PREVIOUS_DIGEST",
          "previousImageId": "sha256:ACTUAL_PREVIOUS_LOCAL_IMAGE_ID",
          "assessment": "Link or brief review of release notes, including migration/rollback impact",
          "clientRuntimeConstraints": ["Cited driver/client/runtime requirement or unknown"],
          "evidence": { "citation": "https://vendor.example/release-notes", "confidence": "verified or provisional" },
          "requirements": [
            {
              "engine": "postgresql",
              "version": { "min": "DOCUMENTED_MIN", "max": "DOCUMENTED_MAX" },
              "extensions": [
                { "name": "extension_name", "version": { "min": "DOCUMENTED_MIN", "max": "DOCUMENTED_MAX" } }
              ]
            },
            { "engine": "mariadb", "version": { "min": "DOCUMENTED_MIN", "max": "DOCUMENTED_MAX" } },
            { "engine": "redis", "version": { "min": "DOCUMENTED_MIN", "max": "DOCUMENTED_MAX" } }
          ],
          "incompatibilities": [
            {
              "engine": "postgresql",
              "version": { "min": "KNOWN_BAD_MIN", "max": "KNOWN_BAD_MAX" },
              "reason": "Cited advisory"
            }
          ],
          "requiresEngineChange": false
        }
      }
    }
  }
}
```

Omit unknown requirements instead of inventing ranges; identify client-runtime constraints and other relevant layers in `assessment` with a citation until a structured check exists. `incompatible: true` or `requiresEngineChange: true` holds an explicitly documented transition. Semver patch/minor/major is only a risk classification; major and non-semver releases prompt release-note assessment rather than a blanket ban. Known incompatible engine/extension ranges hold when matched; an unavailable reading cannot exclude an explicit incompatibility, so that specific transition holds. A documented supported range with no reading is warned as unverified, not treated as proof. The read-only probe uses fixed queries and never applies a dependency change. A missing matrix file is valid; a malformed specified file holds the update path only.

Record the **running container image ID**, registry digest and previous release identity when preparing an actual update. The gate logs the current ID; the candidate's final ID/digest must be recorded after pulling/deployment, not assumed from a tag. `clientRuntimeConstraints` and `assessment` are evidence notes, not automated checks. Moving tags alone cannot establish the bytes that will be pulled. An image rollback reinstates old application bytes, but schema/data migration may also require restoring a matching pre-update backup. Backups and rollback readiness should be checked before risky transitions; the release matrix does not itself create or verify a backup. No release entries or actual compatibility assertions ship in source because they require vendor evidence. Exit 75 from the update gate is a known hold or invalid evidence, not an installation-wide enrollment requirement.
