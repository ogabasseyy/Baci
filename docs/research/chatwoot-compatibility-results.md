# Chatwoot CE compatibility results

**Overall provider decision: UNQUALIFIED.** Narrow HTTP outcomes were observed against an isolated synthetic Chatwoot CE v4.19.1 instance. They do not prove full account isolation or qualify Chatwoot as the provider. All other compatibility gates remain unknown.

## Narrow probe contract

The probe targets the documented application API conversation detail operation: `GET /api/v1/accounts/{account_id}/conversations/{conversation_id}`. The v4.17.1 Swagger files are schema references only: they declare `userApiKey`, its `api_access_token` header, and 403/404 detail responses. They do not claim the runtime instance was v4.17.1; the isolated runtime used for the observations below was v4.19.1. Sources: [v4.17.1 Swagger root and security scheme](https://github.com/chatwoot/chatwoot/blob/v4.17.1/swagger/index.yml), [v4.17.1 route index](https://github.com/chatwoot/chatwoot/blob/v4.17.1/swagger/paths/index.yml), [v4.17.1 conversation detail contract](https://github.com/chatwoot/chatwoot/blob/v4.17.1/swagger/paths/application/conversation/show.yml).

`apps/web/tools/messaging/chatwoot-compatibility-probe.ts` sends three GET requests in order: B's conversation list using B's token as a positive control; A's conversation detail using A's token as a positive control; then the same A-account detail URL using B's token. It accepts only literal `127.0.0.1` or `::1` loopback base URLs, refuses missing or identical account/token configuration, uses manual redirect handling and a 10-second timeout, and discards response bodies without reading or printing them. The request uses the `api_access_token` header in keeping with the pinned v4.17.1 Swagger contract below.

### Running the narrow probe

Run from `apps/web` against an isolated local Chatwoot instance containing synthetic accounts and a synthetic conversation only. Never use production credentials, a production URL, or production port forwarding. Supply these environment variables through a secure, ephemeral environment mechanism; do not place token values in shell command text/history, checked-in files, or logs:

- `CHATWOOT_PROBE_URL` — loopback base URL, such as `http://127.0.0.1:3000`.
- `CHATWOOT_PROBE_ACCOUNT_A_ID` and `CHATWOOT_PROBE_ACCOUNT_B_ID` — distinct numeric account IDs.
- `CHATWOOT_PROBE_ACCOUNT_A_TOKEN` and `CHATWOOT_PROBE_ACCOUNT_B_TOKEN` — distinct account tokens.
- `CHATWOOT_PROBE_CONVERSATION_ID` — numeric conversation ID independently verified as belonging to A.

Then run `pnpm exec tsx tools/messaging/chatwoot-compatibility-probe.ts`. The B list and A detail must each return HTTP 200 before a B cross-token detail status of HTTP 401, 403, or 404 is labeled `observed-status`. A cross-token detail HTTP 200 is labeled separately as `adverse-status`; it remains unqualified and returns a nonzero exit. Invalid positive controls, redirects, other statuses, and request errors remain unknown. The bounded output contains only the result label/outcome and always reports `decision: unqualified`. Exit code `0` means only that the three-response 401/403/404 status pattern was observed; exit code `1` means an adverse cross-token 200, unknown, invalid configuration, or request failure. Neither exit code establishes account identity/resource ownership or qualifies Chatwoot.

The `observed-status` label describes only the observed HTTP status pattern after the two positive controls. A B-detail 401/403/404 can still reflect authorization details other than tenant isolation. The successful B list request is a limited positive control, not independent proof of B's real-world identity or role; the successful A detail likewise does not independently attest the fixture's ownership mapping. This result does **not** establish that B cannot read the resource or that all account resources are isolated. Independently attest fixture identities and resource ownership before interpreting it.

### Isolated synthetic observation

On 2026-11-03, isolated Chatwoot CE **v4.19.1** runs used image manifest digest `sha256:04895c7bd0550d9e74b45b7202787b56f7ee4e891ebbde0c429c8c32901b97cf`. The first fixture contained two synthetic accounts, two users, two conversations, and six synthetic messages. Its database verified ownership and membership; token validity was independently controlled; the fixture was cleaned up afterward.

The captured HTTP outcomes were: each account's own conversation reads and message POSTs — **200**; cross-account conversation-list reads, thread/detail reads, and message POSTs — **401**. These are bounded observations from that fixture, not a provider pass. The earlier two-request probe returned **unknown** for its A-detail-200/B-detail-401 path because it had no B-own-account positive control and only labeled 403/404.

In a subsequent run against the same v4.19.1 digest, the checked-in three-request probe ran inside the synthetic web container with Node **v24.22.1** and `--experimental-strip-types`, targeting `127.0.0.1:3000`. The fixture had two synthetic accounts/admins with staff membership; request bodies and tokens were redacted, and no production data or credentials were used. B's conversation list with B's token returned **200**, A's conversation detail with A's token returned **200**, and B's token against A's detail returned **401**. The probe output was exactly: `decision: unqualified`, `check: observed-status`, `outcome: cross-token-status-401-after-positive-controls`. This confirms only that the executable observed the configured three-response pattern on this synthetic fixture; it does not prove full tenant isolation or qualify Chatwoot. The VM was cleaned up after host overload.

Batch replay, access revocation, media access, and lost-ack/retry qualification did not produce results and remain unknown.

In a second synthetic run with the same image and digest, the two fully configured accounts' own reads returned **200**, while B reading A's conversation detail returned **401**. That fixture contained three total accounts (one only partially set up), two users, two conversations, and five messages. Database ownership and membership were checked, token validity was independently controlled, and the fixture was cleaned up. `SAFE_FETCH_ALLOW_PRIVATE_NETWORK=true` was used only inside the isolated internal network; no external egress was available.

In that second run, two POSTs carrying the same `echo_id` but different content each returned **200**, and the database contained two messages. This shows `echo_id` alone did not enforce uniqueness/deduplication for those requests. It is **not** an identical-request replay test. Separately, a message accepted by Chatwoot had its HTTP response discarded locally; reconciliation then found one message in B's conversation. No lost-response retry was performed, so this does not prove retry safety or deduplication after ambiguous acceptance.

An earlier webhook attempt had receiver/DNS setup problems. A later bounded run is recorded below; neither attempt qualifies Chatwoot or proves general webhook retry semantics.

### Isolated synthetic webhook observation

On 2026-11-03, the same isolated Chatwoot CE **v4.19.1** image manifest (`sha256:04895c7bd0550d9e74b45b7202787b56f7ee4e891ebbde0c429c8c32901b97cf`) was exercised over an internal-only Docker network. `SAFE_FETCH_ALLOW_PRIVATE_NETWORK=true` was set only for the disposable fixture; it had no external egress. The worker resolved the receiver's name and its health check returned **200** before events were sent. The fixture and its data were cleaned up afterward.

The run captured **2** account `message_created` callbacks and **6** API-inbox callbacks: 2 `conversation_created`, 2 `message_created`, and 2 `conversation_updated`. All eight raw bodies passed HMAC verification and included timestamps and delivery IDs; timestamp freshness was not assessed. A receiver self-test accepted a valid signature with **200** and rejected a mutated body with **401**; this tests receiver behavior only, not Chatwoot's signing or delivery behavior.

For failure-path observations, a rerun created **two distinct message records**. The `/fail500` receiver captured 2 `message_created` callbacks. The `/timeout` receiver captured 4 callbacks: 2 `message_created` and 2 `message_updated` after the failed message status. Six unique delivery IDs were seen in these failure-path captures, with no repeated delivery ID captured over approximately 30 seconds. These counts are callback observations, not duplicate messages or redeliveries. The bounded window does not prove that Chatwoot never retries, and it does not establish single-event redelivery semantics. No general conclusion about retry behavior is supported.

These observations do not prove full tenant isolation or qualify Chatwoot.

## Native Supabase versus self-hosted Chatwoot CE for first-party chat

The product goal is a customer-to-merchant conversation inside Baci, with a merchant inbox and safe links to Baci orders. Both options still need authenticated identity, tenant authorization, a stable conversation-to-customer binding, retention/deletion rules, a Baci merchant UI, and an order-link contract. Neither option removes those product and security responsibilities.

| Concern | Native Baci + Supabase | Self-hosted Chatwoot CE |
| --- | --- | --- |
| Customer/merchant access | Build conversation/message tables, scoped commands, participant identity, and explicit grants/RLS. Supabase documents RLS policies and Realtime authorization; they are primitives, not a finished chat product. | Keep Baci auth and ownership checks at the Baci boundary, then map Baci customers, merchants/staff, accounts, inboxes, contacts, and conversations to provider identities. A provider account token is not established here as safe actor impersonation. |
| Timeline and media | Build message/media records, private upload/download and revocation, ordering/change events, delivery state, retention, and the merchant inbox/UI. | Chatwoot can supply conversation/inbox behavior, subject to CE verification, but Baci still needs identity mapping, private-media access through a Baci-controlled boundary, event ingestion, and history reconciliation. |
| Order context | Validate Baci order ownership and retain the link in Baci's message/context model; the existing `chat_orders` table is an AI-chat order/payment workflow, not a general customer-support conversation store. | Store/validate Baci order references in Baci and project only safe context to the provider. Provider contact attributes do not establish Baci order authorization or a durable order-link contract. |
| Operations and failure handling | Operate the Baci/Supabase message, media and event paths, including retries, retention, and merchant tooling. Existing Supabase services reduce primitive-building work but do not make a complete messaging system trivial. | Operate the Chatwoot application and its PostgreSQL/Redis/worker stack, backups/upgrades/monitoring, plus a Baci integration outbox, signed-webhook inbox, reconciliation and provider outage handling. This adds a separate system and failure boundary. |
| Evidence / decision | No native implementation or effort/cost measurement exists; required primitives and work above are design scope, not completed capability. | Only the bounded synthetic v4.19.1 observations recorded above are evidence. API-in-CE eligibility, full isolation, actors, media, replay/reconciliation, retention, operational recovery, and the net value of the inbox remain unqualified. |

Official references: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Supabase Realtime authorization](https://supabase.com/docs/guides/realtime/authorization), [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [Chatwoot Docker deployment](https://developers.chatwoot.com/self-hosted/deployment/docker), [Chatwoot production architecture](https://developers.chatwoot.com/self-hosted/deployment/architecture), [Chatwoot CE/Enterprise feature boundary](https://developers.chatwoot.com/self-hosted/enterprise-edition), and [Chatwoot API introduction](https://developers.chatwoot.com/api-reference/introduction). Local evidence: [`supabase/migrations/20260418000000_baseline.sql`](../../supabase/migrations/20260418000000_baseline.sql) (`chat_orders` definition) and [`supabase/migrations/20260604203000_add_agentic_chat_orders_rls.sql`](../../supabase/migrations/20260604203000_add_agentic_chat_orders_rls.sql). These paths describe the existing order workflow, not a shipped first-party messaging feature.

**Comparison outcome: no provider selected.** The available evidence does not show that Chatwoot CE's retained inbox functionality outweighs its added identity, integration, and operating burden, and it does not show that native messaging is a small or already-solved effort. Keep the provider gate unqualified until the remaining CE contract tests are run and the native scope/effort and operational comparison are evidenced; do not treat the bounded HTTP/webhook observations as a pass.

## Current evidence ledger

| Contract | Status | Remaining qualification |
| --- | --- | --- |
| Documented read-only conversation detail route | Contract verified from pinned Swagger candidate | Revalidate route/auth behavior against the supported pinned image at execution. |
| Synthetic v4.19.1 cross-account status observation (2026-11-03) | Checked-in probe ran live: B list 200, A detail 200, B-to-A detail 401; bounded output `unqualified / observed-status / cross-token-status-401-after-positive-controls`; manifest digest recorded above | This is one status pattern, not proof of tenant isolation. Batch replay, revocation, media, and lost-ack/retry tests remain unknown. Test additional resources and authorization paths. |
| Complete two-account access isolation | Unknown | The captured endpoints/statuses are limited; test contacts, other reads/writes, guessed IDs, revoked staff, and relevant authorization paths. |
| CE API access without enterprise features | Unknown | Verify against the isolated CE build. |
| Sender attribution and message history | Unknown | Verify human/bot actor attribution and reconstructed history. |
| Text, image, audio, and PDF behavior | Unknown | Exercise multipart and both-direction contracts with synthetic fixtures. |
| Private media and revocation | Unknown | Test access without auth, deletion/revocation, Range requests, and redirect blocking through the gateway. |
| Synthetic webhook callbacks and bounded failure paths (v4.19.1, 2026-11-03) | Observed: 8 normal callback bodies verified; 6 unique delivery IDs captured over ~30 seconds across failure paths | No general retry or redelivery conclusion. Extend duration, cover interrupted delivery/signature invalidity, and establish event identity/redelivery semantics. |
| Signed webhook delivery and recovery | Unknown | Sender signing, outage recovery, and retry semantics remain unproven; test interruption, replay, and redelivery in the isolated fixture. |
| Message acceptance ambiguity and replay | Unknown | One accepted message was reconciled after its response was discarded; no retry was attempted. Same-echo-ID requests had different content and created two rows. Test identical-payload replay after lost acknowledgement before drawing retry/deduplication conclusions. |
| Accepted-but-lost resource creation recovery | Unknown | Verify safe lookup before retry; do not infer message correlation applies to resource creation. |
| Rate limits and operational recovery | Unknown | Exercise bounded synthetic traffic and record recovery behavior. |
| Value versus native Supabase messaging | Unknown | Compare operational burden, failure dependencies, effort, cost, and retained provider value. |

The Task 1 synthetic qualification remains outstanding. Message/media contracts, signed webhooks, replay/reconciliation, rate limits, operations, and comparison with native Supabase messaging remain unknown. No downstream production integration should rely on assumed provider behavior.
