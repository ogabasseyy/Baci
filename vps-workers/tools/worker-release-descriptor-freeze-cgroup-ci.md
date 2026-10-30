# Descriptor freeze cgroup prototype

`worker-release-descriptor-freeze-cgroup-ci.py` creates one uniquely named
child under the disposable runner's cgroup v2 root. It first probes PID
migration, runs the descriptor-freeze tests, kills any remaining processes
through that child's `cgroup.kill`, verifies `populated 0`, and removes the
child cgroup. It leaves the runner's own cgroup and worker services untouched.

The workflow sets `WORKER_RELEASE_REQUIRE_CGROUP=1`: missing root/cgroup v2,
writable delegation, or `cgroup.kill` fails CI. Running the harness locally
without that variable permits an explicit `SKIP`; a skipped run is not
evidence that the cgroup transfer path passed. The harness pins the cgroup
directory by device and inode and verifies the no-follow path still resolves
to that inode before removal.

The harness loads the regular descriptor-freeze unit tests and the separate
`worker_release_descriptor_freeze_cgroup.test.py` kernel integration suite by
their exact file paths. Both test modules stay within the repository's
300-line source limit.

Passing this prototype does not establish production readiness. Production
must launch the extractor in a fixed, root-owned, non-delegated systemd cgroup
with an ephemeral UID, empty supplementary groups, no capabilities, no
`CAP_SYS_ADMIN`, `NoNewPrivileges=yes`, `ProtectControlGroups=yes`, and
`KillMode=control-group`. The broker must retain the cgroup directory until it
has read the kernel's `cgroup.procs` and `cgroup.events`, require the child PID
to be a member before waiting, then require the cgroup to report empty before
ownership transfer. It must prevent migration into or out of that cgroup and
prevent writable file descriptors from escaping to processes outside it.
The prototype does not configure or verify those systemd and broker policies.
