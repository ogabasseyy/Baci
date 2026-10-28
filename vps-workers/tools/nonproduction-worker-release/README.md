# Nonproduction worker release identity harness

This harness is intentionally limited to a caller-provided temporary root. It
never creates users, changes host groups, installs units, reads production
secrets, or contacts GitHub/Supabase/provider APIs. Use it to validate directory
ownership/mode intent before staging the real identity migration on a disposable
Linux VM.

The current broker has fixed production paths (`/srv/baci-workers`) and the
trusted dispatcher path is host-installed. Consequently, this harness checks
provisioning prerequisites only; it does not exercise broker dispatch or
service transitions. Those require an isolated Linux VM with dedicated
`baci-release` and `baci-worker` UIDs and a reviewed test dispatcher.

Run:

```sh
python3 vps-workers/tools/nonproduction-worker-release/check-layout.py --root /tmp/baci-worker-layout
```

The root must already exist. The checker reports expected layout only and does
not mutate it. Exit 0 means directory structure and modes match the contract;
ownership is checked only when `--release-uid` and `--worker-uid` are supplied.
