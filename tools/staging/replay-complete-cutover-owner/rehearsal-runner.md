# Rollback-only replay rehearsal runner

The separately sealed `replay_rehearsal_seal.py` entrypoint loads the exact
reviewed source closure from a fresh root-owned private directory. Launch with
`python3 -I -S -B`; authenticate the bootstrap hash externally before execution.
The sibling `replay-claim-fence` directory must exactly match its frozen source
inventory. Extra files and bytecode caches are refused before disk imports.

`--check` performs read-only inventory, historical completion authentication,
current full application snapshot collection and receipt routine verification.
It cannot submit the rendered transaction or create the submission marker.

`--rehearse` admits only the already-reviewed rollback SQL bytes, once. It holds
the replay, application-admin and notification-renewal locks throughout collection
and audit retention. The exact root-owned sticky `/run/lock` parent is supported;
other writable parents are refused. Lock files remain root-owned, single-link,
non-writable to other users, and inode-checked.

Before SQL submission, an exclusive private marker is fsynced along with its
directory. An unknown acknowledgement is never retried automatically; the same
package cannot submit another transaction after that marker is created.

Full before/after application and receipt evidence stays in a private audit.
Public output contains status, acknowledgement flags, audit path/hash and explicit
false financial/start authority. Only `capturedAt` may differ between application
snapshots. Notification or catalogue drift causes refusal, not normalization.

This runner does not install the claim fence, start replay, refresh credentials,
change grants, run the financial worker, send payments, or credit interest. Those
remain separate reviewed activation steps. Staging expires on 6 October 2026 at
15:59:10 UTC; this runner does not renew it.
