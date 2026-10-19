# Local authenticated cancellation preparation

Ready for parent integration review. No deployment route is bound.

## Files

- `customer-cancel-handler.ts`: authenticated fixed-goal GET quote and POST preparation through existing `createCancelPlan`.
- `customer-cancel-handler.test.ts`, `customer-cancel-handler.body.test.ts`: synthetic auth, tenant, CSRF, exact command, replay, uncertainty, identity drift and bounded-body cases.
- `../../schemas/piggyvest-customer-cancel-handler.ts` and colocated test: reuse shared public contract and canonical fixed-goal/actor validation.
- `customer-request-body.ts` and colocated test: exact previously private policy reader extracted; both policy and cancellation handlers now import it. The existing policy handler change is only that authorized extraction/import.

## Boundaries

Authentication via `getUser` occurs first. POST validates CSRF, exact raw JSON and public schema before database reads. Only explicitly configured staging/local_test context is accepted. Merchant/customer are derived from the authenticated RLS context; request goal must equal the canonical fixed server goal. Scope and actor are revalidated before restricted execution and before returning success.

Cancellation statements have exactly six parameters. Quote actor is parameter index 5; preparation actor is inside the strict command JSON at index 5. The adapter command must exactly equal the server-constructed confirmation including authenticated actor, operation ID and all quoted assertions. No policy seven/eight-parameter heuristic is reused.

POST does not obtain a fresh quote before preparation. Exact operation/payload replay reaches existing SQL replay logic. Stale assertions or response loss are not interpreted as a released reservation: unavailable preparation retains `reservation: may_be_retained`, `dispatch: contract_gap`. No automatic retry, settlement, refund, provider call or interest disposition occurs. The command executor is response-bounded to five seconds; the supplied real restricted executor retains responsibility for its own database timeout/cleanup. Late completion is not returned as a new successful response.

The shared wire contract uses `accepted: true`, goal correlation on all quote/receipt states and operation correlation on both receipt states. UUID request bytes are preserved on correlated POST responses while comparisons and internal database identifiers use validated canonical UUIDs.

## Validation

- Initial TDD run failed on the intentionally missing handler import.
- Final owned focused run: 36 tests across four files passed, including corrected typed chunk fixtures; scoped Biome passed after formatting.
- Hooke independently reported no P1/P2 findings and 75 tests across five selected handler/helper/policy files passing after extraction.
- Leibniz independently reported five real local PostgreSQL connected tests passing (script exit zero) before helper extraction; that integration and fixture are not owned here.
- Parent owns final full lint/typecheck/tests; no full-suite process was started or left running here. Two owned test typing errors reported by integration were corrected without touching other agents' fixtures.

## Remaining gates

No SQL, credentials, environment, provider transport or deployment changes. Real restricted-role provisioning and deployment binding remain owner-gated. Existing reviewed cancellation policy mapping must be explicitly enabled through its approved local fixture/administrative boundary. Provider cancellation/refund mechanism and interest disposition remain unresolved; preparation is not a completed cancellation or refund.
