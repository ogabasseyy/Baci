# Hosted savings funding service candidate

This is an inactive, owner-run systemd unit candidate for the standalone artifact
the parent build produces. It binds only `127.0.0.1:4795`, fixes
`BACI_WORKER_PROFILE=hosted-savings-funding`, and uses a root-managed server-only
environment file. It does not start, enable, restart, or expose the service.

The candidate accepts no artifact, configuration, or unit-directory overrides.
It validates only the fixed root-owned artifact at
`/opt/baci-savings-funding`, its non-writable ancestors and tree, the fixed
root-managed configuration file at
`/etc/baci/piggyvest-staging/funding-service.env`, and the fixed root-managed
CA certificate at `/etc/baci/piggyvest-staging/postgres-ca.pem` (`0444`,
single link); it does not read or print configuration values.

The database CA is delivered as a systemd credential, not through the
environment file: `EnvironmentFile` parsing drops multiline values, while
the application requires the PEM with real newlines. The unit loads the
fixed CA file with `LoadCredential` and the fixed `ExecStart` wrapper
exports it from `$CREDENTIALS_DIRECTORY` before `exec`-ing node
(`ImportCredential` only propagates manager credentials; it does not set
environment variables). The environment file must omit
`PIGGYVEST_SAVINGS_FUNDING_DB_CA`. The service account cannot traverse
the secret directory, so only the credential path works. Absolute, dangling, cyclic, escaping, environment-targeting,
or unsafe symlinks are refused; relative internal symlinks are accepted only when
their resolved target and all in-root ancestors remain root-owned and non-writable.
`.env` files in the artifact are refused. The
hosted funding environment profile fails closed during application boot if
identity, test credentials, or TLS configuration is missing or invalid. The unit
requires `BACI_SAVINGS_LEASE_EXPIRES_AT` to equal the fixed deadline epoch before
booting, has a seven-day runtime cap, and is stopped by the inactive deadline
timer pinned to `2026-09-29 15:59:10 UTC`.

Before either mode succeeds, the candidate also requires the configured
`baci-savings-funding` account and group to exist and proves, without executing
artifact code, that the service identity can read every artifact file and read
and traverse every artifact directory. The root-managed environment file remains
read by systemd rather than being made readable to the service account.
This is a POSIX-mode preflight only: it does not evaluate filesystem ACLs and
does not claim the candidate is boot-ready.

Owner review must still supply a reviewed standalone artifact, a root-owned
configuration file at `/etc/baci/piggyvest-staging/funding-service.env`, the
restricted service account, verified staging identities, and a lease stop
controller. These are blockers; this candidate is not active or installed.

After review, an owner may run `--check`. `--install` is root-only and only writes
new units in `/etc/systemd/system` when none exists; it still does not start or
enable anything.
