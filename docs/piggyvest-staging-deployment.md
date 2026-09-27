# PiggyVest staging deployment handoff

Updated 11 September 2026. The owner requested research and implementation, confirmed Cloudflare browser access, and confirmed that PiggyVest has not sent staging credentials yet. No provider messages were sent.

## Current outcome

- Public registration URL: https://ogabassey-piggyvest-staging.vercel.app/api/webhooks/piggyvest
- Verified unauthenticated GET 200 from the local computer and VPS. Response: `registration_ready`, environment `staging`, event processing `disabled`.
- Initial deployment verified HEAD 200, POST 503 with `PIGGYVEST_NOT_READY`, unrelated `/api/orders` 404. A subsequent profiling correction is described below; the receiver never treats an acknowledgement as financial acceptance.
- Custom registration URL: https://staging.ogabassey.com/api/webhooks/piggyvest — DNS configured, Vercel ownership verified, and HTTPS GET 200 verified on 11 September 2026 at 12:04 UTC.
- Custom-domain checks from the VPS using ordinary public DNS: GET/HEAD 200, empty POST 503 with `PIGGYVEST_NOT_READY`, unrelated `/api/orders` 404. Local HTTPS GET also returned 200 with certificate validation using `--resolve` and the address returned by public DNS; the local default resolver still cached the earlier missing record. Do not claim propagation to every resolver.
- No PiggyVest credentials, provider API tests, funding, wallet mapping, storage or financial processing configured. Registration reachability is the completed milestone; event processing and end-to-end sandbox tests remain pending.

## Why this deployment

### POST profiling correction

The provider clarified that both GET and POST must be supported for profiling, then supplied a forwarded `{ "test": "ping" }` probe. That example has Hookdeck headers, `X-Hookdeck-Verified: false`, and no `x-pvb-signature`. Hookdeck headers and idempotency keys do not authenticate a PiggyVest financial event.

The corrected registration handler acknowledges requests without `x-pvb-signature` with HTTP 200 and plain-text `OK`, consistent with the provider's invalid-signature acknowledgement example. Such unauthenticated bodies are not read, stored, logged or processed. This deliberately does not provide durable acceptance: no wallet events are accepted as trusted. Repeated unsigned probes are harmless no-ops.

Requests carrying any `x-pvb-signature` still return 503 until staging credentials and durable ingestion exist; without the secret their authenticity cannot be determined. This is a temporary readiness limitation, not full compliance with the documented always-200 event receiver. Do not claim all POST requests succeed or provider profiling is complete. Acknowledging potentially authentic deliveries before durable storage would risk event loss. Do not provision credentials and enable processing without implementing the remaining inbox, mapping and reconciliation requirements.

Regression testing reproduced the old 503 for the unsigned probe, then passed after the fix. The forwarded probe regression uses synthetic header values only. All 33 focused tests pass. Compiled-package local HTTP checks on the VPS verified GET/HEAD/unsigned POST 200 and signature-bearing POST 503. Repository lint/typecheck passed; no full-suite rerun was performed for this narrow follow-up.

The correction was deployed on 11 September 2026 using prebuilt artifacts to the same staging-only project. Current deployment: `dpl_BZmWu5NTtuACW9ki6kM8VNYUbanP`, immutable URL https://ogabassey-piggyvest-staging-6vm11smla-basseys-projects-d7395611.vercel.app. Build directory: `bassey@82.29.190.219:/tmp/piggyvest-post.iC7tm2`; local deployment directory: `/private/tmp/piggyvest-post-deploy.BnSSVH`. Handler SHA256: `d45c0daa0285ff4a529a67a00683c4bc06f81335cbf4b08e1da0b8597ccfb3c2`. CodeRabbit completed with zero findings; the later synthetic forwarded-header test and documentation edits were added during/after that review and are not claimed as an immutable reviewed snapshot.

After deployment, ordinary public HTTPS requests to the custom URL verified GET 200, unsigned synthetic Hookdeck-style POST ping 200 with `OK`, and signature-bearing POST 503. A second unsigned POST ping from the VPS also returned 200. The local DNS resolution issue no longer occurred. These are our synthetic checks, not evidence of successful PiggyVest profiling or signed event delivery. No credentials or storage were provisioned, and no production Baci deployment or DNS changes were made in this correction.

The provider's [payload documentation](https://www.piggyvestbusiness.com/docs/webhooks/payload) requires a GET 200 reachability check to register the URL. This can be exposed separately while financial processing awaits credentials. The [signature sample](https://www.piggyvestbusiness.com/docs/webhooks/signature) still needs a signed sample to settle its JSON serialization behavior.

A dedicated Vercel project avoids copying Baci production secrets, enabling existing cron jobs or touching live savings balances. It contains only the registration handler. A full Baci preview would require substantially more configuration and isolation; a separate VPS web service would add process, ingress and certificate maintenance. The existing VPS was used only to produce the tiny prebuilt package.

[Vercel Build Output API](https://vercel.com/docs/build-output-api/primitives) supports this standalone Node function. Its handler checks the actual hosting project against its staging project binding using [Vercel system variables](https://vercel.com/docs/environment-variables/system-environment-variables). Preview targets and incorrect/missing project bindings fail closed. The main Baci route remains disabled.

## Initial deployment identity (superseded by POST correction above)

- Team: `basseys-projects-d7395611`
- Project: `ogabassey-piggyvest-staging`
- Project ID: `prj_vgV7DiXC52wOhbClB2uzjGAg9IZd`
- Deployment: `dpl_CjrzDHTVQcM6PgGvuAMBWRbezVsc`
- Immutable URL: https://ogabassey-piggyvest-staging-j5t8orin9-basseys-projects-d7395611.vercel.app
- Vercel target: `production` within this staging-only project. This does not deploy or promote the main Baci project.
- Source: `apps/web/tools/piggyvest-staging/registration-handler.ts` and `build-registration.ts`, still uncommitted in this task worktree based on `d0d1cbd2fd`.
- Built handler SHA256: `3686aca9aea579f6e58f9f8369c0b82c0d2210dca928fa6779ba898b67a8f369`.
- Build host/directory: `bassey@82.29.190.219:/tmp/piggyvest-registration.oRvKZJ` (Node 24.18.0).
- Local deployment directory: `/private/tmp/piggyvest-staging-deploy.EANeYz`.
- Deployment command used `vercel deploy --prebuilt --prod`; no `vercel build` or remote source build. Vercel confirmed prebuilt artifacts were used.

Project protection defaults remain unchanged. A `vercel curl` invocation generated an automation bypass credential in this staging project; no value was printed. That command then failed on argument parsing. All reported public HTTP verification used ordinary unauthenticated requests, without that credential.

## DNS changes completed with owner approval

The saved Cloudflare token returned 403/code 9109. After the owner signed in and explicitly approved adding staging DNS records, the in-app Browser was used to add the two records below. The existing three `_vercel` TXT records were preserved. No root, email, nameserver or production routing records were changed.

Vercel's project-domain API accepted `staging.ogabassey.com` and returned this ownership challenge. Its DNS configuration API returned the following preferred CNAME. Recheck existing records before adding either; preserve other `_vercel` TXT values.

| Type | Name | Value |
| --- | --- | --- |
| TXT | `_vercel` | `vc-domain-verify=staging.ogabassey.com,32c7fb84c885351d4d94` |
| CNAME | `staging` | `a4879e64f41693bf.vercel-dns-016.com` |

Both new records use Auto TTL; the CNAME is DNS-only. Vercel's verification endpoint returned `verified: true`; its DNS configuration endpoint returned `misconfigured: false`, with no conflicts. Managed TLS subsequently passed ordinary curl certificate validation. No certificate-verification bypass or deployment-protection bypass was used. Initial DNS/TLS failures during provisioning resolved on the VPS; local resolver propagation remains pending as noted above.

## Rebuilding

Use a fresh temporary output directory. On Node 24, import `buildRegistration` from `build-registration.ts` and call it with the fresh directory and staging project ID above. It strips TypeScript types and emits only `.vercel/output/config.json` and the standalone function package. It refuses to overwrite existing output. Link only to the named staging project, then deploy with `--prebuilt --prod`. Never link this artifact to project `baci`.

Before redeploying, rerun the colocated tests, lint/typecheck, code review and compiled-package HTTP smoke checks. The build contains no provider secrets or database connection strings. Runtime staging markers are public configuration, not credentials.

## Validation and remaining work

- 28 focused tests passed across the registration builder/handler, signature primitive and disabled main-app route.
- `pnpm turbo lint && pnpm turbo typecheck` passed; existing warnings remain.
- CodeRabbit uncommitted review including untracked files completed with zero findings across nine files, before deployment.
- The earlier full test run had one failure in the unrelated Cloudflare process-isolation test because it requires a clean worktree. That full gate has not become green; do not bypass it or claim otherwise. No commit or merge performed.
- Before actual event ingestion: obtain staging credentials and signed event samples; implement the durable inbox, restricted database worker, tenant/account mapping, replay handling and reconciliation described in the readiness report. Provision isolated storage only for this phase, with no production data.
- Only synthetic data and sandbox operations are permitted. Do not acknowledge financial events before durable acceptance. Do not assume undocumented retry behavior, interest rates, event schemas or final status enums.

## Message John can send now

“We’ve updated the endpoint and verified that GET and the POST test ping you shared return HTTP 200. Please retry the profiling check at https://staging.ogabassey.com/api/webhooks/piggyvest. Signed wallet-event processing will be enabled after staging credentials and secure event ingestion are configured.”

This is a draft, not a sent message or confirmation of provider registration.
