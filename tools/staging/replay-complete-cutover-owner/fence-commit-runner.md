# Separate receipt generation fence application

The commit runner consumes the actual rollback attestation retained at
`/root/baci-replay-rehearsal-r3.85HQ4psI/rehearsal-result-631a248b83894c95a579e2f229188999.json`.
Its reviewed SHA256 is
`2220425c4f261719bedc49355974eeae36b150071f404bca9c722be153d74a7b`.
The inner receipt SHA256 is
`c1c6376733c80550543184b91d32ac2aab8428091302be6bdd1c8ba28a282faa`.

The exact commit SQL SHA256 is
`ff36e1b56df2247f416398a176eea613216831f9b54a45fe7f36f4c67455ce1f`.
The existing rollback submission marker is never removed or reused. Commit has
its own durable exclusive submission marker. An unknown acknowledgement does not
permit resubmission, rollback, runtime start, or predecessor recovery.

The runner authenticates its sealed source, original definition, financial
completion audit and actual rehearsal result, holds the three existing locks,
independently inventories halted claimants, and compares complete current
application snapshots before and after application. Receipt tables, signatures,
quarantine, routine metadata and unrelated functions must remain unchanged;
only the reviewed claim routine body and definition may change.

`--check` is preparation only. `--commit` installs the fence and leaves replay
stopped. Neither mode runs a payment worker, creates a charge, transfers funds,
credits interest, restarts a predecessor, or extends the October 6 deadline.
The spent 10000-kobo treasury cap is not reset. Both savings plans retain their
existing principal.

After independently verifying a committed receipt, the remaining separate gates
are authenticated invalid-bound probes (old credentials rejected, new generation
reaches bounds validation), candidate readiness and guarded complete-generation
startup. A commit result alone does not establish end-to-end delivery or authorize
synthetic interest to be credited to a customer account.
