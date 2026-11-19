# BrilStash pilot operator runbook

Use the [pilot specification](2026-11-18-catalogue-pilot.md) for the product contract and qualification steps. The [pilot fixtures](pilot/) contain synthetic data. Partner communications, hosted sandbox publication, registration, and live rollout require separate authorization. Production scheduling remains disabled.

## Commands and credentials

The commands take a local JSON file. Builder and operator commands use an ordinary Supabase Auth access token in `BRILSTASH_TOOL_ACCESS_TOKEN` and the project’s public key in `NEXT_PUBLIC_SUPABASE_ANON_KEY`. For a hosted target, set `BRILSTASH_TOOL_TARGET=hosted`, the exact `NEXT_PUBLIC_SUPABASE_URL`, and its `BRILSTASH_SUPABASE_PROJECT_REF`. For a disposable local API, set `BRILSTASH_TOOL_TARGET=local` and use a numeric loopback URL with an explicit port. Use separate credentials and projects for sandbox and live. Keep secrets out of JSON files, command arguments, shell history, and review evidence.

```sh
pnpm --filter @baci/web brilstash:manage inspect.json
pnpm --filter @baci/web brilstash:build stage.json --apply
pnpm --filter @baci/web brilstash:manage action.json --apply
pnpm --filter @baci/web brilstash:verify probe.json --apply
```

Operator inputs have the shape `{"action":"inspect-candidate","args":{"p_installation_id":"<uuid>","p_candidate_id":"<uuid>"}}`. The [operator schema](../../../apps/web/src/schemas/brilstash-operator.ts) lists the actions and their exact arguments. `--apply` is needed for writes. For a lost response, inspect persisted state before repeating an operation.

Use a separate, installation-scoped builder account. Supply the installation ID, stable candidate UUID, reviewed merchant slug, and product hostname to the builder. The command stages a candidate. Inspect the exact candidate and its digest, then record the operator's approval before first activation or handoff of a replacement. Record the fresh BrilStash installation evidence while both partner import controls are disabled. For first activation, the candidate must contain all seven reviewed listings. Activate that exact staged candidate during its dated Lagos window and inspect the resulting active generation and activation timestamp.

## Verify and hand off

The Host header is client-supplied routing input for the Next.js route. The hostname and deployment checks select the configured ingress. The database RPC independently requires the installation bearer and checks admission, freshness, and eligible rows for every request. This applies to direct PostgREST requests as well.

Set `BRILSTASH_FEED_HOST` to the approved bare lowercase DNS hostname without a port or trailing dot. Configure ingress to send that same Host value for the HTTPS feed. Use the same hostname in the URL saved in BrilStash. Supply the intended partner bearer via `BRILSTASH_FEED_BEARER`. The probe input includes `installationId`, `expectedGenerationId`, and `expectedPayloadDigest`. The probe checks the exact HTTPS URL with `page=1&limit=100&min_price=0`, rejects redirects, compares all projected values and array order, and samples serving state on both sides of the request. The live feed accepts unfiltered page 1 with any limit from 7 through 100 so that the full pilot fits on one page. The handoff probe always uses 100. Use `--apply` to persist the successful receipt and obtain its `probeId`. Use `check-handoff` with that ID before a registration operation.

Configure the shared Upstash Redis rate limiter in both feed deployments. The feed admits up to 30 qualifying requests per minute per trusted client IP before calling the database. Requests without a trusted IP share one bucket. An exhausted budget or unavailable limiter returns 429 with `Retry-After`. Treat the entire pull as failed and retry within the agreed retry window.

Before recording handoff evidence, confirm the probe URL and the effective URL saved in BrilStash both use the approved deployment’s `BRILSTASH_FEED_HOST`. The operator verifies this deployment setting. The database checks the probe URL shape and requires the saved URL to match that recorded probe exactly.

Configure the proven drain and retry bounds with `configure-drain` before recording saved-connection verification. Read the exact saved partner installation, configuration revision, and effective URL and query from BrilStash. With imports disabled, obtain evidence from its non-applying connection check or held auto-import that ties the request ID and `X-Baci-Catalogue-Proof` to that exact saved configuration and, when held, to the immutable run, attempt, and result. Correlate the request with Baci’s server logs, including the non-secret key ID and generation. Store the approved evidence reference with `record-saved-connection`. This command records the operator’s attestation after independent partner readback. The local evidence format assumes BrilStash can return the request and proof headers or provide equivalent verifiable evidence through an agreed protocol. Keep imports disabled until this capability is qualified.

- For a saved connection or immutable draft, use `check-handoff` with the probe and verification IDs immediately before any authorized conditional enablement. Ask BrilStash to enable exactly the verified configuration revision. Use `record-enablement-readback` to record the revision and both import controls observed at BrilStash, with an evidence reference and a stable observation UUID. Use `inspect-enablement` to compare the observed and verified revisions. Record the first catalogue import separately.
- For a held automatic import, record the exact attempt with `record-release-request` before sending any release. Use the verification ID returned by `record-saved-connection` and all corresponding generation and revision values. Then use `check-handoff` with the probe, verification, and release IDs. Release only the verified immutable result using BrilStash’s conditional operation. Keep future pulls and all other jobs held.
- If the generation, intended key, or relevant revisions changed, verify the current approved generation and saved connection again. If an action is indeterminate, check the exact partner revision or attempt before retrying.

Inspect `inspect-releases` for unresolved and overdue attempts. Record an acknowledged queue operation as `awaiting_application`. Use terminal dispositions only after the partner confirms exact application, cancellation or discard without application, or reconciled partial application. During suspension, cancel or contain potentially released attempts, verify withdrawal and reconcile before resuming.

Retire a wrong fresh binding with `retire-installation` and qualify a different fresh partner installation. For an activated installation, suspend it first and record verified partner disablement and final job disposition before retirement. Retirement revokes all keys and retains the installation and its history.

## Promote or suspend

Stage, inspect, and approve the exact candidate digest before closing reads. Calculate the latest closure as 23:30 Lagos minus 10 seconds for admitted responses, the confirmed partner drain and retry bound, and the promotion allowance. Start closure early enough for the commit and its observation to occur by that time. After the close command commits, run `observe-closure` with its closure revision. Use the returned time to start waiting for in-flight responses and, if relying on expiry, the additional partner retry and drain interval. The database enforces the dated window, closure revision, partner disposition, and candidate freshness. From 23:30 Lagos through the configured retry window the read gate requires enough freshness to cover the window. Reads always retain the 26-hour hard expiry from the source read. Keep a failed drain closed unless the recovery procedure proves the old generation can safely reopen.

For urgent withdrawal use `suspend` or `suspend-listings`. This closes reads and marks unresolved releases for withdrawal. Before `resume`, verify the partner-side off-sale result and disposition of all jobs that could restore the listing, then stage and approve a replacement. The normal scheduler cannot promote or restore serving.

When a previously published source becomes untracked but is still public with the same identity, use `approve-stock-withdrawal` with the listing’s existing external ID, the current catalogue revision, and the reviewed stock evidence. Stage a replacement, then review its unchanged ID and zero quantity. The prior generation stays unavailable until you promote the approved replacement through the relevant drain or recovery procedure. Use urgent withdrawal and retirement for an item that is private, repurposed, or recalled.

If a storefront migration changes an approved source ID, use `remap-listing` only after reviewing evidence that the replacement is the same sellable. It retains the external ID and previous source history. Review facts for the replacement source before building. The old generation becomes ineligible while it identifies the previous source.

## Qualification still required

Confirm category labels, NGN precision, bearer and request deadline behavior, saved-connection correlation and revision-bound enablement, selective release and terminal readback, importer treatment of failed pages, delayed retry or commit bounds, HTTPS reachability, and daytime stock exceptions with BrilStash. Qualify single-page imports before live rollout. Multipage paging in local fixtures does not qualify a partner crawl or late-commit protection.
