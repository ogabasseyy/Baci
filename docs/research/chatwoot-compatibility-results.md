# Chatwoot CE compatibility results

**Overall provider decision: UNQUALIFIED.** Only a narrow read-only, two-token HTTP check is implemented. No provider was contacted in this work; the probe's existence and mocked tests are not provider evidence.

## Narrow probe contract

The probe targets the pinned candidate's documented application API conversation detail operation: `GET /api/v1/accounts/{account_id}/conversations/{conversation_id}`. The v4.17.1 Swagger path declares `userApiKey` authentication and 403/404 responses. Chatwoot's own v4.17.1 profile API spec exercises access-token authentication through the `api_access_token` header. Sources: [pinned route index](https://github.com/chatwoot/chatwoot/blob/v4.17.1/swagger/paths/index.yml), [pinned conversation detail contract](https://github.com/chatwoot/chatwoot/blob/v4.17.1/swagger/paths/application/conversation/show.yml), [pinned Chatwoot profile API spec](https://github.com/chatwoot/chatwoot/blob/v4.17.1/spec/controllers/api/v1/profiles_controller_spec.rb).

`apps/web/tools/messaging/chatwoot-compatibility-probe.ts` sends two GET requests to the same A-account conversation URL: first with A's token, then with B's token. It accepts only literal `127.0.0.1` or `::1` loopback base URLs, refuses missing or identical account/token configuration, uses manual redirect handling and a 10-second timeout, and discards response bodies without reading or printing them. The probe uses Chatwoot's documented `api_access_token` header rather than an HTTP Bearer scheme.

### Running the narrow probe

Run from `apps/web` against an isolated local Chatwoot instance containing synthetic accounts and a synthetic conversation only. Never use production credentials, a production URL, or production port forwarding. Supply these environment variables through a secure, ephemeral environment mechanism; do not place token values in shell command text/history, checked-in files, or logs:

- `CHATWOOT_PROBE_URL` — loopback base URL, such as `http://127.0.0.1:3000`.
- `CHATWOOT_PROBE_ACCOUNT_A_ID` and `CHATWOOT_PROBE_ACCOUNT_B_ID` — distinct numeric account IDs.
- `CHATWOOT_PROBE_ACCOUNT_A_TOKEN` and `CHATWOOT_PROBE_ACCOUNT_B_TOKEN` — distinct account tokens.
- `CHATWOOT_PROBE_CONVERSATION_ID` — numeric conversation ID independently verified as belonging to A.

Then run `pnpm exec tsx tools/messaging/chatwoot-compatibility-probe.ts`. Before interpreting the result, independently verify that each token authenticates for its declared account and that the conversation belongs to A; this probe does neither. It prints only a bounded status report. Exit code `0` means only that A returned HTTP 200 and B returned HTTP 403/404 (`observed-denial`); exit code `1` means unknown, invalid configuration, or request failure. Neither exit code qualifies Chatwoot as a provider.

The narrow check is labeled `observed-denial` only when A receives HTTP 200 and B receives HTTP 403 or 404. Every other result is unknown; the result always says the overall provider decision is unqualified. A 403/404 may also mean B's token is invalid or otherwise unusable; this probe does not authenticate B independently. The label describes only the observed HTTP status pattern. It does **not** establish that B cannot read the resource, that the conversation is owned by A, that either credential corresponds to the declared account, or that all account resources are isolated. Independently verify both identities and resource ownership in the isolated fixture before interpreting the result.

## Current evidence ledger

| Contract | Status | Remaining qualification |
| --- | --- | --- |
| Documented read-only conversation detail route | Contract verified from pinned Swagger candidate | Revalidate route/auth behavior against the supported pinned image at execution. |
| A-token baseline and B-token denial for an A-owned resource | Unknown | Run only against the isolated loopback instance after independently verifying A/B identities and conversation ownership. |
| Two-account access isolation beyond this one conversation request | Unknown | Test contacts, conversation lists, guessed IDs, revoked staff, and other relevant reads. |
| CE API access without enterprise features | Unknown | Verify against the isolated CE build. |
| Sender attribution and message history | Unknown | Verify human/bot actor attribution and reconstructed history. |
| Text, image, audio, and PDF behavior | Unknown | Exercise multipart and both-direction contracts with synthetic fixtures. |
| Private media and revocation | Unknown | Test access without auth, deletion/revocation, Range requests, and redirect blocking through the gateway. |
| Signed webhook delivery and recovery | Unknown | Test signatures, replay, interruption, and redelivery. |
| Message acceptance ambiguity and replay | Unknown | Drop acknowledgement after acceptance and establish replay/reconciliation behavior. |
| Accepted-but-lost resource creation recovery | Unknown | Verify safe lookup before retry; do not infer message correlation applies to resource creation. |
| Rate limits and operational recovery | Unknown | Exercise bounded synthetic traffic and record recovery behavior. |
| Value versus native Supabase messaging | Unknown | Compare operational burden, failure dependencies, effort, cost, and retained provider value. |

No Chatwoot installation, account, API, webhook, or media endpoint has been contacted. The Task 1 synthetic qualification remains outstanding, and no downstream production integration should rely on assumed provider behavior.
