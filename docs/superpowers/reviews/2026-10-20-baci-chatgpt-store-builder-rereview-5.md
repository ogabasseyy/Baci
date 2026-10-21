# Baci ChatGPT Store Builder — Fifth Plan Rereview

**Date:** 20 October 2026

**Scope:** Manual rereview of the latest plan/design at repository baseline `270fe355d8a78ddb685e3e490fcf6652fe89910e`. Focus: the private/public storage prerequisite, approval/retry state transitions and preservation of current authorization. No application implementation or live status check was requested or performed.

**Disposition:** One P2 retry-order gap is clarified in the [plan](../plans/2026-10-20-baci-chatgpt-store-builder.md) and [design](../specs/2026-10-20-baci-chatgpt-store-builder.md). No additional P1 planning gap was verified in this pass. Task 0's privacy/runtime/preview proof and Task 1's OAuth proof remain unexecuted prerequisites.

## R22 — P2: Reconcile committed confirmations before validating approval for a new write

The plan required current receipt replay and also required an unexpired, unused approval plus an exact draft version. It did not specify their order or cover a successful commit followed by a delayed retry after approval expiry or a subsequent draft edit. Running the approval verifier/CAS first would incorrectly reject that retry even though publication already succeeded.

This follows up R5's recovery contract with a distinct missing ordering/test case; it does not recount frozen response caching as a new finding. The current Muse pure verifier illustrates why the distinction matters: `apps/web/src/lib/connector/approval-proof.ts` rejects expired approvals and consumed nonces. That is correct for authorizing a new effect. It is not a committed receipt resolver. The new builder verifier remains separate, and Muse code is unchanged.

### Correction and acceptance

Task 8 now owns the explicit transaction order:

1. Authenticate and recheck current owner, connection/grant, scope and target authority; retain R14's serialization with revocation.
2. Lock/resolve the canonical request/effect and verify its stored input and intent binding. Reject same-key/different-input and unauthorized cross-connection replay.
3. If the exact authorized effect has committed, return the same receipt's current delivery/supersession state. Do not apply new-write expiry, consumed-nonce, draft CAS or readiness checks to that read-only reconciliation.
4. Only when no receipt exists, enforce all new-write checks, then atomically consume the nonce and commit publication/history/audit/receipt/outbox. Concurrent waiters re-read the receipt after acquiring the lock.

Required tests cover response loss followed by a retry after the ten-minute approval expiry, consumed nonce and later draft edit; all return the existing receipt with no second effect. Expired/used approvals without a matching receipt still fail. Changed canonical inputs still return `IDEMPOTENCY_CONFLICT`. Revoked/removed callers remain denied before replay. A separately signed-in owner can retry already-committed delivery through the established recovery path without reviving a ChatGPT grant.

## Other conclusions

- R21's private-draft split is still a prerequisite to prove, not a completed privacy fix. The plan preserves installed mobile/public published-config reads and rejects privileged/private-draft compatibility shortcuts.
- Homepage-only scope, exact intent-bound confirmation preview, canonical grant checks and native publication supersession remain consistent.
- Both existing submissions remain protected. No cancellation, refresh, resubmission or deployment is implied.

## Validation boundary

Document checks cover relative links, fences, placeholders, whitespace, task sequence and the new retry-order/negative-case requirements. No application suite, CodeRabbit review, database migration/test, OAuth conformance or ChatGPT host QA was run. No code, environment, credentials, production data or submission changed.

## Input fingerprints

Before this pass:

```text
plan   191460942b1c0c0bb97c7e29923179b5f8f4ff48f6e29f37feb39f75caf0c47a
design 4937ec73e265581e1980c76f3ce7e0d406b1e7add7116b48b8ab8aa93ac6c5fb
```
