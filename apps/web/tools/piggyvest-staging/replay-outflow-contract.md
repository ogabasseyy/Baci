# Replay outflow contract handoff

These adapters are not wired into the replay worker, the transfer outbox, or any ledger.

## Required before activation

- A trusted, event-specific terminal identity normalizer, verified against genuine PiggyVest terminal payload samples. It must yield the exact reference, amount, NGN currency, source, destination, direction, provider customer, business, and integration identities. Generic webhook envelopes and wallet identifiers alone do not establish ownership.
- A business-scoped read lookup that returns the expected submitted operation only inside the trusted provider customer, business, and integration scope.
- An atomic SQL compare-and-set writer that accepts the complete expected operation, terminal evidence, and requested status. It must compare all identities and `submitted` state in one transaction, then return only `applied`, `duplicate`, `terminal-conflict`, or `not-submitted`.
- Replay receipt decoding and dispatch changes that route documented outflow terminal events to this adapter without fabricating `pvb_wallet`. Unsupported, malformed, or incomplete evidence must remain unresolved.
- An explicitly scheduled TSQ caller. `reconcileTransactionStatus` is read-only: it never sends a transfer request and terminal TSQ results remain unresolved because the published TSQ response lacks currency, source, and destination evidence.

## Current boundary

No database atomicity has been tested. The existing reference-only outbox updater is not a suitable CAS writer. These helpers do not update the existing outbox or any ledger. A normal HTTP `202` is documented acceptance for a scheduled transfer, not a missing provider API contract.
