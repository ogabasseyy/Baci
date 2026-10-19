# Reviewed staging draft cutover

This one-use bundle expires at **2026-09-21 11:24:05 UTC**. It does not deploy
Vercel, modify production, provision credentials, or move funds.

The owner wrapper is `/private/tmp/baci-drafts-cutover-20260920-reviewed.sh`.
It invokes one interactive sudo command over SSH, verifies embedded checksums,
and copies the verified scripts into a private root-owned directory before execution.
The remote staged bundle is
`/home/bassey/baci-isolated-savings/cutover-reviewed-20260920-1950`.

The artifact pin covers the complete standalone tree: 11,302 regular files and
eight internal symlinks, including sibling `node_modules`. Only the existing
pinned staging public key is placed in the service configuration. No service-role
or PiggyVest credential is used.

Execution refuses changed artifacts, existing destination/units, expired leases,
unexpected listeners and unsafe Nginx state. It verifies a restricted loopback
smoke service on 4794 before stopping the identity-checked legacy listener on
4792. The replacement has no restart or boot enablement. Its absolute deadline
timer is enabled; the start guard independently refuses expired leases.

The Nginx mutation happens only after replacement health succeeds. The existing
Nginx installer restores the prior configuration if its validation/reload fails.
Other activation failures stop the newly installed services and leave artifacts
for diagnosis. **The old private process is not automatically restarted.** Do not
rerun after a partial failure; inspect the reported stage first.

Success proves restricted service startup and route installation, not public
authenticated persistence, phone readiness, or funding/interest/refund processing.
Those checks and the dedicated Vercel prebuilt routing deployment remain separate.
