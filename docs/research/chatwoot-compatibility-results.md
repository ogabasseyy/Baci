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

Then run `pnpm exec tsx tools/messaging/chatwoot-compatibility-probe.ts`. The B list and A detail must each return HTTP 200 before a B cross-token detail status of HTTP 401, 403, or 404 is labeled `observed-status`; invalid positive controls, redirects, other statuses, and request errors remain unknown. The bounded output contains only that result label/outcome and always reports `decision: unqualified`. Exit code `0` means only that the three-response status pattern was observed; exit code `1` means unknown, invalid configuration, or request failure. Neither exit code establishes account identity/resource ownership or qualifies Chatwoot.

The `observed-status` label describes only the observed HTTP status pattern after the two positive controls. A B-detail 401/403/404 can still reflect authorization details other than tenant isolation. The successful B list request is a limited positive control, not independent proof of B's real-world identity or role; the successful A detail likewise does not independently attest the fixture's ownership mapping. This result does **not** establish that B cannot read the resource or that all account resources are isolated. Independently attest fixture identities and resource ownership before interpreting it.

### Isolated synthetic observation

On 2026-11-03, the isolated Chatwoot CE **v4.19.1** fixture used image manifest digest `sha256:04895c7bd0550d9e74b45b7202787b56f7ee4e891ebbde0c429c8c32901b97cf`. It contained two synthetic accounts, two users, two conversations, and six synthetic messages. The fixture database verified ownership and membership; token validity was independently controlled; the temporary fixture was cleaned up afterward.

The captured HTTP outcomes were: each account's own conversation reads and message POSTs — **200**; cross-account conversation-list reads, thread/detail reads, and message POSTs — **401**. These are bounded observations from that fixture, not a provider pass. The prior two-request probe itself returned **unknown** for its A-detail-200/B-detail-401 path: it had no B-own-account positive control and only labeled 403/404. The updated three-request probe (B list, A detail, B against A detail) is covered by mocked unit tests only; it was **not** run against the now-removed instance. Thus this fixture evidence does not claim that the updated executable reproduced the captured sequence.

This evidence does not prove full tenant isolation, identify all authorization causes, or establish webhook support. No webhook contract or delivery was tested.

## Current evidence ledger

| Contract | Status | Remaining qualification |
| --- | --- | --- |
| Documented read-only conversation detail route | Contract verified from pinned Swagger candidate | Revalidate route/auth behavior against the supported pinned image at execution. |
| Synthetic v4.19.1 cross-account read/write status observations (2026-11-03) | Observed: own reads/POSTs 200; cross-account lists/threads/POSTs 401; manifest digest recorded above | Prior probe returned unknown; updated positive-control implementation has mocked tests only and was not run on the removed fixture. Repeat under a retained isolated fixture and test more resources. |
| Complete two-account access isolation | Unknown | The captured endpoints/statuses are limited; test contacts, other reads/writes, guessed IDs, revoked staff, and relevant authorization paths. |
| CE API access without enterprise features | Unknown | Verify against the isolated CE build. |
| Sender attribution and message history | Unknown | Verify human/bot actor attribution and reconstructed history. |
| Text, image, audio, and PDF behavior | Unknown | Exercise multipart and both-direction contracts with synthetic fixtures. |
| Private media and revocation | Unknown | Test access without auth, deletion/revocation, Range requests, and redirect blocking through the gateway. |
| Signed webhook delivery and recovery | Unknown | No webhook was tested. Test signatures, replay, interruption, and redelivery. |
| Message acceptance ambiguity and replay | Unknown | Drop acknowledgement after acceptance and establish replay/reconciliation behavior. |
| Accepted-but-lost resource creation recovery | Unknown | Verify safe lookup before retry; do not infer message correlation applies to resource creation. |
| Rate limits and operational recovery | Unknown | Exercise bounded synthetic traffic and record recovery behavior. |
| Value versus native Supabase messaging | Unknown | Compare operational burden, failure dependencies, effort, cost, and retained provider value. |

The Task 1 synthetic qualification remains outstanding. Message/media contracts, signed webhooks, replay/reconciliation, rate limits, operations, and comparison with native Supabase messaging remain unknown. No downstream production integration should rely on assumed provider behavior.
