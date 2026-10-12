# Baci R0 — Muse setup and testing

Researched 3 October 2026. This guide separates documented setup from the
interactive results still needed for the R0 exit gate.

## Choose the correct client

| Client | Documented setup | Baci R0 fit |
|---|---|---|
| Personal Muse assistant, on the web or in its app | Ask the assistant in chat to build a custom connector from the service API details. Meta documents secure storage for its credentials. | Use the existing REST/OpenAPI harness and the operator's secure credential prompt. |
| Muse Code, in Terminal or a code editor | Configure an MCP server in `settings.json` or project `.mcp.json`; start a new process and inspect `/mcp`. | The current harness is REST, so an MCP adapter is required for this configuration route. |

The installed CLI identifies itself as **Muse Code 1.4.2**, an interactive
terminal coding agent. The operator's returned response says that its
session has no connector setup or secure prompt. That initial response did
not identify the client conclusively or demonstrate authenticated access.
The operator subsequently requested the personal desktop-app prompt,
reported an API-key prompt, issued a test token using the native helper and
reported entering it in Muse. Initial list/get 200 have now been observed
in harness logs, and operator-reported results match the synthetic fixture.
Manual rotation, old-key denial and secure replacement now also pass.
Explicit revocation denial before expiry and two agent-driven timed reads
now also pass. Native desktop scheduling, automatic refresh, cross-device
reuse and operation-specific approval receipts remain unverified. The
temporary transport is stopped; another run needs fresh runtime access,
a new URL and a new operator-issued credential. Vault entry and saved skill
are operator-reported; fresh-conversation reuse remains pending.

Official references:

- [Meta help: how Muse works with connectors](https://www.meta.com/help/artificial-intelligence/1687253048996149/)
- [Meta research: custom connectors and credential isolation](https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)
- [Muse Code: MCP server configuration](https://meta-models.github.io/muse-code-sdk/next/guides/extend/mcp-servers/)

These references do not establish availability in the operator's particular
session. If the personal assistant cannot offer a secure credential entry,
record that result and stop setup before issuing a token. Directory
submission is a separate process from this private pilot.

## Personal-assistant setup

Open a conversation in the personal Muse assistant and paste:

```text
Build a private custom connector named Baci R0 Staging from this REST API:
<STAGING_BASE_URL>/openapi.json

Use bearer authentication. Ask me for the access token through your secure
credential entry and store it outside chat, generated code, and logs.

Call orders.list with {"limit":5}, then orders.get for one returned order.
Show the actual outcomes and synthetic order IDs. Keep payment and shipping
statuses separate. Save the working integration for reuse after it succeeds.
All four tools (orders.list, orders.get, inventory.levels,
analytics.summary) have runtime in this harness; the pilot proof starts
with orders.
```

Replace the URL with the current preflighted tunnel URL. At the secure
prompt, paste the access token from a local issuance call (`POST
/v0/issue-token` on `127.0.0.1` with the owner secret; see the gateway
README). A request to paste the token into conversation text does not
satisfy this setup contract. There is no menu helper — issuance,
rotation, and revocation are direct local HTTP calls.

## Prove the connector through real calls

1. **Initial access:** reconcile Muse's listed IDs and one retrieved order
   with harness HTTP logs. Expect the three seeded merchant-A orders. A
   successful discovery fetch alone proves no authenticated access.
2. **Reuse:** request another live order read in a fresh conversation and
   record whether the saved integration is available.
3. **Rotation:** the operator rotates via local `POST /v0/refresh` with
   the stored refresh token. Ask Muse for a fresh live read with its old
   credential and observe denial. Replace it through the secure entry and
   repeat the read. Record manual replacement separately from any
   automatic platform refresh.
4. **Revocation:** local `POST /v0/revoke` revokes the grant. Ask for a
   fresh live read and reconcile the denied request with HTTP logs.
   Previously retrieved conversation content can remain visible.
5. **Scheduling:** if offered, observe two scheduled synthetic reads and
   record duplicate handling. Remove the pilot schedule afterwards. If
   unavailable, record the Baci-owned alert fallback. R0 has no event cursor.
6. **Remaining observations:** follow the runbook for discovery, safe error
   handling, approval evidence and optional cross-device reuse. Writes stay
   disabled; approval dialogs alone provide no Baci-verifiable receipt.

Record operator-reported interface behavior separately from observed Baci
HTTP outcomes. Follow the runbook teardown: revoke pilot grants, return the
branch gateway to NOLOGIN, stop transport and remove temporary secrets.
R1 implementation and staging validation are complete under the 3 October
authorization (see the R1 staging proof); production deployment still
needs the production-scope ADR-003 decision.
