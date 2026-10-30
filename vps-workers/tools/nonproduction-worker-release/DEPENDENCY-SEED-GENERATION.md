# Authenticated seed-generation prototype

`dependency_seed_generation.py` composes the authenticated dispatcher archive,
the real `worker_release_dependency_policy_cache.preverify()` pnpm commands,
the fixed egress broker, and the immutable per-SHA seed publisher. It is not
called by the production broker.

The generation entry point does not accept a success flag or a policy receipt.
It verifies the dispatcher response against `AuthenticatedRun`, extracts the
exact archive into a frozen root-owned source tree, and launches the worker in
a bounded `PrivateNetwork=yes` transient unit as the dedicated
`baci-worker-egress-bridge` identity. The unit sees only read-only source and
verifier code, writable per-run cache/store binds, the pinned Node/pnpm files,
system CA certificates, and the fixed `/run/baci-worker-egress.sock` bind of
the root broker socket `/run/baci-worker-egress/broker.sock`. pnpm's HTTPS
proxy variables are forced to the unit's loopback CONNECT listener and
`NO_PROXY` is cleared. The host broker still validates its peer identity,
registry hostname, TLS SNI, and resolved public address. The unit masks the
host `/run` tree and binds back only the fixed broker socket at its worker
alias; the disposable systemd fixture checks a second host Unix socket is
unreachable while the approved alias remains usable.

On successful worker exit, the orchestration retains the transient unit long
enough to compare its effective user, group, network, mount, resource, and
process properties to the fixed contract. It then stops the unit and proves
systemd collection, exact cgroup absence, and absence of processes for the
dedicated host UID before it reads the worker-written policy receipt. The root
process independently revalidates that receipt against the exact source and
cache, checks the source tree digest again, transfers the generated cache and
store to root ownership through no-follow descriptors, freezes them, and
publishes through `publish_seed()`.

The published schema-2 manifest carries a generation attestation binding the
authenticated run fence, compressed archive digest, frozen source-tree digest,
transient unit name, quiescence proof category, and the pnpm policy receipt.
The root caller must re-read the authenticated in-progress run fence after
copying and verifying the seed and immediately before the no-replace rename.
The publisher is a private helper that accepts only an opaque in-process
generation capability containing the independently validated receipt,
root-created attestation, and fence guard; plain dictionaries and directly
constructed capability objects are rejected. This prevents accidental API
misuse inside the prototype; it is not a security boundary against other
trusted same-process root Python code. It does not publish when the guard
rejects. Existing per-SHA seeds are reused only after full immutable tree,
source, receipt, and attestation verification, and the return value carries
the stored verified attestation rather than claiming the current run created
it. The
publisher and later seed verifier/recovery reject an absent or mismatched
attestation. The tree and attestation are protected by root ownership and the
publisher's immutable no-replace publication. The attestation is a structural
root-generated record, not a cryptographic signature; it relies on the trusted
root staging process and root-owned seed tree.

Generation is serialized by a fixed workspace lock. If a crash leaves source
or run scratch in that workspace, future generation fails closed and preserves
it for inspection; automated cleanup is intentionally not attempted because
the interrupted transient unit must first be independently proven quiescent.

The prototype requires separate deployment work before it could run on a host:
the fixed `/var/cache/baci-worker-release/seed-work` directory, dedicated
egress account, root egress broker socket, root-owned verifier code, and
root-owned pinned runtime paths must already exist and pass its checks. This
task does not provision or activate those paths. The in-process archive
extractor and staging snapshot helper are also prototype-only; production must
replace them with the journaled constrained extractor. Root-only seed tests
and a disposable Linux/systemd egress integration run are required before any
production wiring.

The test helper `dependency_seed_test_support.py` creates structurally valid
fixture attestations for synthetic package trees. It does not verify pnpm,
systemd, egress, or GitHub provenance and must never be used by production
callers.
