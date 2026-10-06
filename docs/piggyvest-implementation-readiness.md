# Implementation and activation readiness

Updated 12 September 2026. This report does not narrow the full savings integration
goal or mark unfinished product behavior complete. Work remains local in
`/Users/mac/Baci-worktrees/cursor-savings-phase1`.

## Implemented and exercised locally

- Exact-variant savings selection and recovery from the earlier implementation.
- Raw signed request intake connected to committed PostgreSQL storage, duplicate
  detection and unsupported-event quarantine through separate restricted roles.
- Single-dispatch customer/plan provisioning. Unexpected `new_customer: false`
  is now uncertain, not accepted ownership. Fresh validated creation acknowledgements
  use an atomic provenance receipt; historical records cannot acquire that proof.
- Bounded verification followed by transactional customer/first-plan completion
  and immutable wallet mapping. Completion replay performs no new provider lookup.
  Unknown creation results never automatically POST again.
- Fixed-origin read-only funding-account and transaction-observation adapters.
  Transaction projection checks wallet, business, transaction and customer binding,
  but never infers monetary units, interest entitlement or financial finality.
- Bounded accrued-interest page retrieval with trusted wallet/business/customer
  checks, explicit date windows, strict pagination and staging isolation. Its
  amounts remain provider observations with unconfirmed units and are never
  posted to the ledger or shown as spendable cash.
- Immutable balanced internal ledger with explicit integer-kobo commands, durable
  evidence/idempotency checks, separate principal/paid/pending interest, exclusive
  purchase/refund reservations, release/settlement and full-credit reversals.
- Server-resolved savings policy view backed by that ledger. It rejects supplied
  financial fields, checks integration/merchant/customer scope and excludes pending
  interest from purchasing power. A lower qualifying price offers customer review;
  it does not auto-buy, silently cancel a plan or describe a price reduction as a gift.
- A staging-labelled customer status component and safe server projection now
  render exact device labels, confirmed purchasing power and separate pending
  interest from the same internal snapshot. Synthetic integration tests exercise
  the projection and component together; no live customer page/route is wired yet.

These modules do not change production Paystack behavior. Internal ledger commands
are not PiggyVest payloads or proof of cash. A successful wallet creation is not a
deposit. A ledger settlement is not proof that an external transfer succeeded.

## Local verification

- Latest focused provider/schema/customer-status/nonpayment-variant run: 73 suites,
  827 tests passed. Ten real-database cases skip in this ordinary run and pass
  separately below. Migration registry and analytics authority rerun: 58 tests
  across three suites passed (separate, overlapping scope; do not add counts).
- Combined real PostgreSQL runtime: 3 suites, 10 tests passed. Provider HTTP is
  simulated; global fetch is prohibited. Includes first customer and first plan
  confirmation/mapping, request intake, commits, duplicates and internal ledger/view.
- Dedicated ledger SQL harness: lifecycle, permissions, immutable balanced journal,
  restart recovery and four synchronized two-session races passed.
- Recovery agent: 36 scoped tests and three real SQL fixtures plus restart passed.
  Its results overlap combined tests and must not be added as unique coverage.
- Lint and typecheck passed with existing warnings. Full monorepo results are
  recorded separately in the implementation progress log; targeted passes do not
  imply a green full suite or a physical mobile acceptance result.
- All 30 savings/staging migration drafts are exact-hash registered. No migration
  was applied to a remote database. Full production-schema/RLS replay is outstanding.

## Not finished: implementation versus external gates

Remaining local product implementation includes persisted product consent/lifecycle
wiring, authenticated page/route integration of the status component and funding
details, settlement/order finality and
compensation, cancellation interest disposition/refund workflow, schedules and the
isolated deployable HTTP artifact. Existing libraries and a policy read model are
not a substitute for these end-to-end product paths.

Only the affected paths should remain disabled while contracts are incomplete:

1. Financial webhook-to-transaction linkage, exact amount/balance units and category
   semantics must be verified before creating provider-backed ledger postings.
2. A signed financial sample and exact raw-byte signature/header contract are needed.
   The previously supplied Hookdeck ping is not that financial contract. Its relay
   signature must not be confused with `x-pvb-signature` or the API secret.
3. Durable-outage acknowledgement, provider retry/redelivery and reconciliation
   behavior must be agreed before choosing the deployed HTTP response policy.
4. Interest routing, paid-interest eligibility and the mechanism for forfeiting
   all plan interest on customer cancellation need authoritative terms. Business
   approval of the use case is accepted and is not being reopened.
5. Confirm settlement/refund destinations and fee treatment before movement. Fees
   are deferred, not zero; sandbox fee observations are not production pricing.
6. Collection bridge, split-payment ordering/compensation, maturity/grace and the
   exceptional FX cancellation policy must not be invented or silently activated.

## Separate live states

### Authenticated draft consent — local composition verified

Concrete authenticated RLS context now derives the actor/customer from the session
and enforces configured staging merchant, project and synthetic-customer allowlists.
The draft GET/POST handler validates exact stored revision and SHA256-verified
server-owned terms, checks CSRF, bounds request reads and returns no-store responses.
POST always re-enters the idempotent SQL acceptance boundary, including replays.

The review panel displays supplied terms and the exact device, requires an explicit
unchecked acceptance, and only displays recorded consent after an exact validated
server acknowledgement. Session/goal/loader changes invalidate old reads and actions.
No callback completion implies a guarantee, collection activation or interest.

Parent local evidence: 91 suites / 1,130 tests passed; four suites / 19 tests skipped
in the normal provider/UI/schema run. A subsequent added stale-read regression
passed in the eight-test panel suite. The actual restricted policy executor passed
nine tests in a disposable PostgreSQL database, including deferred-COMMIT failure,
replay, least privilege and restart persistence. A separate three-test composition
exercises concrete identity resolution, real cookie CSRF and the handler-to-panel
flow with synthetic database responses; it is not an external auth/provider test.

There is still no deployed route or production savings-page registration. The
handler requires an explicitly supplied request-authentication adapter and scoped
executor. Before any external connection, bind these to the approved isolated
staging auth/database environment, supply the exact reviewed terms document and
validate deployment and provider behavior separately. No production terms document
was invented, and no funds or provider credentials were used.

### Latest local addition — not activation

Funding-panel race protections and versioned draft-policy/consent storage now have
parent verification: 82 suites, 975 passing tests; ten tests across three suites
skipped by the normal-run configuration. The separate disposable policy database
harness passes real lock-waiter races and restart durability. The policy writer is
accepted only in explicit local-test configuration; TLS use remains rejected.
All new SQL is pending and hash-pinned, with no remote application or role grants.

The resolver still returns `needs_migration`, and no authenticated customer page
or acceptance ceremony is connected to this policy store. Provider chronology,
financial posting, collection activation, settlement/refund workflows and the
previously listed contract questions remain release gates. These checks do not
establish external sandbox readiness or make an old plan eligible for new terms.

| State | Evidence in this implementation run |
| --- | --- |
| Local tests | Passing focused and disposable-database evidence above |
| Deployed staging | No deployment performed or verified |
| Provider profiling | Not verified in this run |
| Credentials received | Owner supplied test credentials previously; values not repeated or used here |
| Credential authentication | No authenticated provider API operation performed |
| End-to-end provider sandbox | Not run; synthetic HTTP is not provider acceptance |
| Production certification | Not claimed |

Read-only scoped Zoho search for Anjola's recent email returned connector error 500.
That is not evidence that the email/docs were not sent. No mailbox content or
credentials were printed and no message was sent.

## Approval package before external changes

Obtain explicit owner approval for the exact isolated staging project/database and
domain, reviewed migration set, least-privilege role/secret provisioning, deployment
artifact and bounded synthetic provider scenarios. Do not alter shared production
configuration, DNS, secrets, infrastructure or `proxy.ts` as an incidental step.
Verify actual GET/POST behavior and authenticated durable event acceptance after
deployment before describing the endpoint as ready. Do not use real BVN/customer
data, real bank transfers or production funds for sandbox testing.

## Unsent WhatsApp update

“We’ve added secure webhook intake, wallet setup/recovery and local accounting
tests. We’re completing the remaining integration and sandbox validation before
confirming full readiness. Please share a signed financial webhook sample and
confirm the signature, retry and transaction amount-unit details.”

This is a draft only. Nothing was posted to the group.
