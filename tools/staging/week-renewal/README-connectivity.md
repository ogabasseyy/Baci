# Reviewed staging connectivity renewal

This is connectivity renewal only, ending 6 October 2026 at 15:59:10 UTC.
It does not enable financial replay, card payments, interest crediting or
notifications, and does not certify authenticated or physical-phone readiness.

The read-only owner evidence is pinned at
`/root/baci-activation-evidence.S88Q16M1/activation-evidence.json`, SHA256
`21bf0adf89c122c11353b53e17f90cdfc815484367e9ce3e228fce90729a1236`.
The existing preparation receipt and all eleven originals are independently
revalidated. Fresh inventory, physical databases, funding-function definitions,
existing public JWT signatures and claims, upstream health, firewall rules,
gateway graph and effective systemd units must still match.

The provisioner uses direct PostgreSQL TLS, not a provisioner JWT. Its existing
password/login had no expiry. The separately reviewed transaction bounds only
`piggyvest_staging_provisioner` to the deadline, preserving password, grants and
role attributes. It rehearses with rollback first. No secret or broader role is
created. The existing public anon JWTs already cover the requested deadline.

The activator stops expired funding first, proves financial runtimes remain
stopped, installs only the six prepared candidates using hash/metadata-guarded
atomic replacements, reloads systemd, and arms/proves both absolute deadline
timers before starting services. It generates fresh startup evidence via the
existing service-user inventory helper and installed, hash-pinned validators;
old startup evidence is never reused for the new lease.

It checks active services, process-owned loopback listeners, the ingress socket,
unauthenticated JSON responses at both staging origins, unchanged intake method
response and unchanged financial/retirement snapshots. It performs no provider
mutation or new payment, and never changes production or nginx.

On failure after stopping services it attempts fail-stopped recovery, restoring
only files whose current hashes still match its own writes. Foreign changes are
not overwritten. The password's deadline bound is deliberately not removed.
Ambiguous apply/recovery stays unconfirmed and requires owner audit; it is not
reported as no change. Root-private originals, write journals and result/recovery
reports are retained in the owner bundle directory.

Use `stage-connectivity.sh --stage` to upload and verify the sealed source.
`--activate` is the explicit owner action and handles SSH from the Mac, then
prompts for sudo there. No separate SSH login is needed. Do not retry a refused
activation blindly: inspect its retained root audit and safe stage report first.

Financial replay still requires coherent deadline-bound artifact and restricted
credential renewal. The old checkout remains retired; principal and approved
treasury budget remain 10000 kobo each, with zero reservation/consumption.
Daily accrued interest is pending observation, not paid Earnings or goal progress.
The missing paid-interest bridge is a separate gate, not supplied by this renewal.
