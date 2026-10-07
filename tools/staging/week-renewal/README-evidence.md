# Read-only staging activation evidence

This bundle validates the owner's successful preparation before collecting the
remaining protected facts. It does not renew staging or enable any service,
timer, payment, provider operation or financial replay.

The prepared receipt is pinned to
`152cca796e433b5f1067333a95122a1ad9f50d61697d7935ea11b32931592ace`
at `/root/baci-week-renewal-a.8fbbHHlB/lane-a-preparation`. All 11 original
files and six candidate files must match. The original inventory digest and its
financial summary are recomputed rather than merely checking digest formatting.

Current source pins, stopped financial services/containers, both physical
database identities, the retired checkout, 10000-kobo principal and treasury
budget are checked again. Database reads use sealed `BEGIN READ ONLY` SQL and
finish with `ROLLBACK`; counters, role credentials and retirement fences are not
changed. Matching snapshots and effective service states are required at both
ends of collection.

Existing public anon JWTs are cryptographically verified in owner memory against
the actual isolated REST container's signing key. Issuer, audience, role and
expiry must cover the requested deadline. Keys, passwords, JWTs, provider
response bodies and raw environment values never enter the report.

Funding uses the restricted `piggyvest_staging_provisioner` PostgreSQL login
over TLS, not a provisioner JWT. Its login/expiry and authority metadata are
reported. An expired, absent or unbounded expiry does not become authority to
start or renew anything. Unsafe role capabilities or any unapproved membership
refuse; this login has no approved parent-role memberships in the source contract.

The upstream container IDs, network endpoint IDs and compose labels must match
the pinned gateway binding. The two reviewed firewall DROP rules are checked
without alteration. Upstream health is probed with GET only and curl configuration
loading disabled; the expired fixed
inventory helper is not run. Installed gateway graph hashes and file metadata
are collected for parent review, not represented as a newly approved runtime.

`stage-evidence.sh --collect` verifies a sealed local/remote source closure,
copies it into a fresh root-private directory through owner sudo, and prints a
redacted JSON report followed by `STAGING_ACTIVATION_EVIDENCE_READY`. Only this
bootstrap and its private audit report write files; no live configuration is
changed. The report deliberately says `activationReady:false` and
`renewalApplied:false`.

This does not verify authenticated customer requests, restricted TLS password
authentication, paid-interest receipt application, financial replay or phone
readiness. These require separate reviewed activation and live verification.
