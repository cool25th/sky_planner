# Collector source manifest

`collector-source-manifest.production.example.json` is a template, not a deployable manifest. Copy it into your secret manager or CI secret value, then replace every `.example` endpoint with the approved partner/API feed endpoint for that source and replace `https://your-app.vercel.app/api/revalidate` with the deployed service origin.

Each source entry must provide exactly one of inline `config` or `config_path`, and the resolved config must include a stable `source_id`. The readiness API treats missing source IDs, empty source lists, invalid schema versions, or ambiguous `config`/`config_path` entries as malformed manifests rather than falling back to default credentials.

Before running the scheduled collector, validate the secret payload without touching the database:

```bash
npm run preflight:service-env -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON
```

Keep `artifact_root` under `runtime/collector-artifacts` so scheduled GitHub Actions runs can upload the raw and normalized collector evidence as the `collector-artifacts` artifact.

`/api/ops/service-readiness`, `smoke:service-readiness -- --manifest-env COLLECTOR_SOURCE_MANIFEST_JSON`, and `audit:service-launch` use the active manifest's `auth.token_env` names when checking source credentials. Inline `config` entries and `config_path` entries are both resolved, so keep token env names aligned with the repository or deployment secrets. Non-promo sources must define `auth.token_env`; only `source_type: "promo_page"` entries may omit auth.

The preflight intentionally fails for local database URLs, placeholder feed/revalidation hosts, placeholder or shorter-than-16-character secret values such as `replace-me` or `test-secret`, missing source API keys, missing revalidation secret, collector artifact roots outside `runtime/collector-artifacts`, invalid alert webhook URLs, and placeholder support email domains.

Keep `revalidate.url` free of `secret`, `token`, or API key query parameters. The collector sends `VERCEL_REVALIDATE_SECRET` with the `x-revalidate-secret` header when calling `/api/revalidate`.

Production readiness requires the `revalidate` block. Do not remove it from the deployed manifest; replace the template URL and secret env instead.

After the preflight passes, verify that the alert webhook accepts real delivery:

```bash
npm run smoke:ops-alert -- --event collector_ops_alert_smoke
```
