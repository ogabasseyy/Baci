# Local runner/delivery release-candidate qualification — 2026-11-03

Base at task start: `7a2f3cc9b1f610d33b5c6da49147166f814e2404`. Final current-main base: `f5985ba6aa4dba11abef872a18409518624386e6` (26 upstream wallet-PIN paths; no task overlap; all task bytes preserved).
Isolated branch: `codex/experience-recovery-20261103`.

See [operator package](../../experience-runner-delivery-qualification.md).

New code supplies full installed-tree inventory and pinned Linux verification, with explicit trusted pins and no provisioning or automatic activation. Rootfs inventories include bytes, metadata, symlink targets and extra files. The native driver qualifies the actual Linux runner transport and signed synthetic compile. Live local TLS checks cover immutable output delivery and fail-closed expiry/revocation/rollback. Existing integration tests prove uninstallation and denied in-flight work, and a fresh normal owner/RLS browser matrix covers both trusted parent origins at desktop/mobile widths in all three browser engines.

Validation receipts and review dispositions are stored here. Historical sibling evidence remains historical; no older review/CI receipt is relabeled as current-candidate-wide qualification. `local-installation-pin.json` is an explicitly observed disposable-VM pin, not independently trusted production provenance. `native-linux-proof.json` records remeasurement and actual native runner execution.

Scope: local-only synthetic data, normal auth/RLS; no hosted schema/config change, publication, orders, payments or paid AI/review credits. Benchmarks are parked, and their gates remain unchanged. The previously running Orbit server is preserved.

The frozen candidate is a content-addressed local source archive/tree, with an external manifest/checksums and recovery copy. It is not a pushed PR, merged main, deployed service or production readiness certificate. Exact candidate CI/review coverage, real host installation/TLS/scoped verifier provisioning and authorized activation remain release gates.

Fresh local validation: 48 focused tests passed (35 runner/integrity/TLS/transport, 10 integration/storefront/boot, 2 normal-owner/RLS browser tests, 1 native Linux installation test). The browser regression covers 12 cells. Runner/commerce TypeScript and targeted Biome checks passed. No CWV samples were executed.

The final free CodeRabbit attempt was rejected before review with `Rate limit exceeded`: all three included reviews were used, with a reported 22-minute cooldown. No paid credits were enabled. The candidate is frozen for recovery/review, not committed or approved for release; the required free-review gate remains blocked.
