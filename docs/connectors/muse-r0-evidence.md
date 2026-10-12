# Muse Capability Evidence — R0

Date: 1 October 2026; public-source recheck on 2 October 2026. Method:
public-source verification only. The owner confirms a signed-in desktop
Muse session, but no Baci pilot calls have been observed. Every "pilot
proof required" row below remains an unresolved gate.

## Verified (public sources)

| Behavior | Evidence | Source |
|---|---|---|
| Private custom connectors exist | Users can ask Muse to create an API-backed custom connector. | [Meta Help Center: How Muse works with Connectors](https://www.meta.com/help/artificial-intelligence/1687253048996149/) |
| Credentials stored by Muse | Credentials use a separate secure store; Meta does not review private custom connectors. This removes the directory-review dependency only. | Same Meta Help Center page |
| Disconnect stops exchange | Disconnecting stops future exchange; previously retrieved material may remain in memory/history. | Same Meta Help Center page |
| Approvals and read-only settings exist | Many connectors support read-only access and configurable approval timing. Exact private-connector behavior still requires a pilot. | Same Meta Help Center page |
| Sentinel binds approvals to connector/destination/use case | Meta describes internally enforced capabilities, not a third-party receipt contract Baci can verify. | [Meta: How We Built Safety Into Muse](https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse) |
| Directory requires review | Submit → Meta reviews functional/security/legal + end-to-end testing → appear in directory. | muse.ai/platform (https://muse.ai/platform) |
| Vendor token model (vendor evidence, not Baci proof) | Custom connector backed by vendor API surface (`/openapi.json`, `/llms.txt`) plus a link flow minting a scoped, revocable connector token; credential kept in Muse's Secure Credentials Store. | Vendor report: https://github.com/1clawAI/muse-connector |
| API-key / MCP style auth (vendor evidence, not Baci proof) | Custom MCP data server via endpoint URL + API key in Authorization header. | Vendor guide: https://www.cdata.com/blog/connect-enterprise-data-meta-muse |

## 2 October report reconciliation

- **Use REST/OpenAPI for the Baci pilot.** The actual harness serves OpenAPI
  3.1 and two order-read runtimes; it has no MCP server. This is an
  implementation choice, not a claim of Meta-certified OpenAPI conformance.
- **MCP support remains qualified.** [CData's own setup guide](https://www.cdata.com/kb/tech/d365businesscentral-cloud-muse.rst)
  reports Muse generating a custom client for a Streamable HTTP MCP server.
  [qbash's own documentation](https://qbash.com/docs/tasks/meta-muse) instead
  distinguishes consumer Muse REST connectors from Muse Code MCP support.
  These vendor reports do not establish a universal native private-MCP
  contract. Directory submission options also do not establish that contract.
- **Bearer authentication is the Baci contract.** A qbash working flow uses
  a dedicated bearer credential, whereas CData's guide uses Basic auth.
  Do not claim all reported connectors use bearer tokens. Baci grants bind
  owner, merchant, scope and branch selection; they are not general store
  API keys.
- **Approval gates do not pass approval handoff.** Meta's documented
  Sentinel behavior supplies no demonstrated operation-specific receipt to
  Baci. Baci-owned proof remains required for future sensitive writes.
- **Manual replacement is the current refresh plan.** Securely replace the
  access token after operator rotation, then test old-token denial. Muse
  automatic refresh, expiry UX, custom scheduling and cross-device reuse
  remain unproven. Add those observations to the pilot record.

The [Baci staging brief](./muse-r0-connector-brief.md) contains the actual
request/response shapes and setup template. It has no live URL or credential.

## Not verifiable from public sources (pilot proof required)

| Behavior | Plan pass condition | Current state |
|---|---|---|
| Initial auth (correct Baci user + grant) | Exact pilot-environment round-trip | UNPROVEN — needs pilot Muse + Baci link flow |
| Token refresh (no scope expansion) | Documented rotation semantics | UNPROVEN — no public doc on refresh rotation/expiry for connectors |
| Revocation propagation | Next call denied | PARTIAL — user disconnect documented; no server-side revocation callback/API documented. Baci enforces revocation on next-request check (spike). |
| Tool discovery (stable names + schemas) | Stable manifest | UNPROVEN — no official manifest/OpenAPI/MCP conformance doc found |
| Approval handoff (Baci-verifiable receipt) | Operation-specific receipt Baci can verify | UNPROVEN — Sentinel capabilities are documented as bound to connector/destination/use case, but no externally verifiable receipt is described. Status: no Baci-verifiable operation-specific approval receipt has been demonstrated. **Use Baci-owned proof unless a supported platform contract is proven.** Keep writes disabled until then. |
| Scheduled checks (cursor resumes safely) | No duplicate events | UNPROVEN — no documented cursor/webhook/interval semantics. Baci-only fallback stays the default. |
| Error handling (codes drive next action) | Stable taxonomy | UNPROVEN — no connector error taxonomy; spike defines Baci-side codes only. |
| Cross-device reuse | Same intended grant and access limits on another Muse client | UNPROVEN — account/client availability does not prove custom-connector sync or revocation handling across clients. |

## Conclusion for R0

Public evidence supports the private-custom-connector pilot route and the
Baci-owned approval-proof fallback, but does not prove any runtime behavior.
The seven planned spike proof rows require exact pilot-environment evidence
or their documented blockers/fallbacks before R1 routes are added.
Cross-device observations supplement those planned exit checks.

## R0 exit reconciliation (3 October 2026, owner decision)

R0 exits when both hold: (a) full-schema branch confirmation — complete
(see the [branch proof](./muse-r0-branch-proof.md)); (b) exact
pilot-environment observations for connect, refresh, revocation, and
discovery, or concrete blockers/fallbacks recorded in the pilot runbook —
pending. Public research changes neither row: private custom connectors
remain the pilot route, and no Baci-verifiable platform approval receipt
has been demonstrated, so Baci-owned proof stays required and writes stay
disabled. R0 exit opens read-only R1 staging validation only; production
deployment still needs the production-scope ADR-003 decision.
