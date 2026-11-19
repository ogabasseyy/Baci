# Offline HTTPS CWV harness — 2026-11-03

Base: `7a2f3cc9b1f610d33b5c6da49147166f814e2404` (fetched current main at task start), isolated `codex/experience-recovery-20261103` worktree. Earlier production-integration evidence is historical and is not reissued as current-head review evidence.

## Implemented

Canonical HTTPS merchant origin and fixed, separate-cookie-site execution origin `https://artifacts.baci-cwv.invalid`. Both use real Node TLS sockets inside the existing non-root, read-only, network-disabled gVisor job. A local CONNECT proxy maps exactly these two authorities to the harness listeners. All other CONNECT and ordinary proxy requests fail closed; no DNS/remote egress is used. No Playwright request interception substitutes HTTPS content.

An ephemeral one-day synthetic certificate is generated with the installed `/usr/bin/openssl`. Its private directory and key are local to the job and removed on closure. Chromium trusts only its SHA-256 SPKI through `--ignore-certificate-errors-spki-list`; no global certificate-error bypass, system trust change, merchant key or external certificate service is used. See [Chromium's SPKI verifier contract](https://chromium.googlesource.com/chromium/src/+/bff9ec6/services/network/ignore_errors_cert_verifier.h).

CSS asset rewriting is shared with prerender document generation, including SRI for the delivered CSS bytes. Original compiled-candidate digest remains unchanged. HTTPS reports require TLS transport diagnostics and at least two actual TLS connections; an older HTTP-only worker cannot qualify them. HTTP loopback compatibility remains available.

The trusted local preparation script now bundles, installs and hashes the performance worker alongside the other pinned workers. No installs, image pulls, VM provisioning or production runner changes were performed.

## Evidence and limits

`synthetic-tls-samples.json`: six Chromium cold-context samples (390 and 1440 pixels, three each), custom authored React/CSS compiled and prerendered only in gVisor. Synthetic image plus bundled local font load; hydration commits; no commerce effects are exposed. All six have four TLS connections, visible content, decoded images and zero console/request errors. Frame LCP 112.6–221.5 ms; frame/host CLS 0.

This small synthetic page is transport/functionality proof, not Orbit benchmark evidence or a future-store performance guarantee. The live test explicitly bypasses the *host-load precheck* to complete functional transport coverage on the shared Mac; worker contamination checks remain enabled. Therefore its numerical results must not be promoted as clean-host qualification. No CPU/network throttling or Internet delivery is represented. The 2-second observation window and existing LCP/CLS limits remain unchanged. `cwvQualified` and `releaseQualified` remain false. Field p75, representative Orbit routes, production Linux/TLS delivery qualification and current-candidate release CI/review remain separate gates.

Focused validation: 20 harness/worker/origin/tunnel tests, 32 measurement/qualification/owner-read tests, one live gVisor HTTPS matrix test (six samples); runner and commerce scoped TypeScript checks. Free CodeRabbit review completed with two minor issues describing the same omitted worker-identity hashes. All five omitted files now contribute to the digest; no critical/high issues were reported. This fix was verified by rebuilding the trusted workers and comparing the installed bytes. Source inventory and issue resolutions are retained alongside this note.

No publishing, deployment, hosted schema/config changes, orders, payments, service-role commerce or AI-provider calls were performed. The retained local Orbit preview was not restarted.
