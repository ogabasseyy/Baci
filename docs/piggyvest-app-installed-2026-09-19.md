# Isolated staging app installation

Owner approved correcting inherited PUBLIC permissions while preserving existing staging services. Installed `replay-app-public-grants.sql` and the reviewed app provisioning bundle atomically on cluster `7685292944002592802`, after a successful rollback rehearsal.

Existing non-system roles retain previous PUBLIC relation/function privileges through explicit grants; the restricted PiggyVest roles are excluded. New roles no longer automatically inherit those grants. No production or public gateway configuration changed.

Installed mapping and inflow ledger tables, verified synthetic customer/merchant mapping, restricted app-worker role and recognition/identity RPCs. The installer isolation audit passed before COMMIT. Ledger starts empty: original receipts have not yet been replayed.

Private pre-change schema backup: `/home/bassey/pvb-staging-receipts/review-backups/app-before-permissions-20260919.sql`. Do not restore the whole schema blindly; use the backup to prepare a reviewed targeted rollback if required.

Next: restricted runtime credentials/private REST connectivity, original-receipt replay and duplicate replay verification. This milestone is actual staging schema installation, not financial replay or full savings completion.
