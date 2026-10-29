# Disposable dependency builder systemd test

The `worker-release-dependency-systemd-tests` GitHub Actions workflow runs the
real dependency builder and installer on a fresh Ubuntu 24.04 VM with systemd
as PID 1. It creates temporary `baci-release-build` and `baci-worker` users,
mounts the builder's fixed 4 GiB tmpfs, and removes only the fixture paths and
identities it created. The script refuses pre-existing fixed paths or users.

The fixture builds a small synthetic workspace containing independent web and
worker lockfiles. Before invoking the builder it runs the exact web deploy and
standalone worker install online with pnpm 11.7.0, frozen lockfiles, lifecycle
scripts and pnpmfile hooks disabled, and `PNPM_CONFIG_TRUST_LOCKFILE=false`.
Both commands must print pnpm's supply-chain-policy success line. Both stages
pin the default registry to `https://registry.npmjs.org/`; active `.npmrc`
settings outside the exact `legacy-peer-deps` and `engine-strict` boolean
allowlist are rejected, including all registry, proxy, TLS, and auth settings.
Any workspace YAML containing a registry token or escape syntax is rejected
with a conservative whole-file check, including nested, quoted, flow, and
multiline forms. The fixture
then writes a bounded receipt that binds the synthetic source SHA marker, both
lockfile hashes, both workspace policy-file hashes, pnpm version, effective
flags, pinned registry, and metadata-cache hash.
The actual builder and later smoke unit run with `PrivateNetwork=true`; the
builder recopies store and metadata into private scratch and repeats both
installs offline with the trust-lockfile bypass explicitly disabled. The smoke
runs as the unprivileged builder identity, with only the materialized snapshot
readable, and checks `tsx` and `dotenv` while verifying the snapshot did not
change. The workflow receives no secrets and has read-only repository
permission.

The receipt is a fixture-generated consistency record, not authentication or
provenance evidence; the SHA marker is not proof of source identity. The helper
is not wired to production. Any production use
would require a root-trusted online verifier bound to the authenticated
immutable source and fixed policy, and a network boundary that prevents
package URLs from reaching internal or private destinations. Source markers or
a self-consistent receipt do not establish those facts.

The fixture reports only the count of pnpm's bounded `v<version>/projects`
index directories omitted from each private cache copy. pnpm records temporary
project paths there as symlinks; the builder validates the directory itself
and excludes that transient index subtree, while rejecting links and special
files elsewhere in the shared store. A local synthetic pnpm 11.7 run verified
that web deploy and standalone worker install succeed offline after excluding
these indexes.

The private build scratch budget is 1.5 GiB in aggregate across the builder
tmpfs. It includes the writable per-build pnpm store, metadata cache, copied
source, both installed dependency outputs, snapshot, and smoke evidence. The
metadata cache is separately capped at 256 MiB; the shared store copy and
directory entry counts also have fixed limits. These limits are checked before,
during, and after the isolated build. The 4 GiB tmpfs is an outer filesystem
ceiling, not extra scratch allowance.

This is a Linux/systemd integration fixture, not proof that production
dependencies have been built or that the dependency proposal is ready to ship.
Its synthetic source and SHA are not GitHub provenance evidence. It does not
exercise the broker's authenticated dispatcher response, production lock
files, production package graph, an actual VPS filesystem, or deployment and
rollback. Broker integration remains disconnected until the authenticated
archive seam, durable crash cleanup, production-size resource bounds, and a
successful run of this workflow plus production-graph validation are reviewed.
