# Builder Contabo qualification, 11 November 2026

The Contabo host is x86-64. The pinned gVisor release `release-20261019.0`
was installed from its vendor archive after checking the vendor SHA-512 file.
An isolated direct-OCI smoke process ran as UID 65534 with a read-only root and
network disabled. It could not write to its root or ping an external address.
Both existing CI runner services were active afterward. This is a basic host
smoke test, not a full runner qualification or an adversarial security audit.

The Playwright `v1.63.0-noble` OCI image index fetched from Microsoft Container
Registry has SHA-256
`eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27`.
Its ARM64 manifest is the earlier local proof's
`a0f4498920a5dbac63196d9140ed738ef00470f27e2e74029abd8850b7bd5717`;
its AMD64 sibling is
`bc6ab0d6d44ff4826e4cb8c1e6d801e185bfc42bb0753f8e2a30efc70db054c7`.
The raw index and AMD64 manifest bytes were independently hashed and matched
their advertised digests. These are source-image observations, not an
approved production rootfs inventory or a release attestation.

At the time of the initial smoke test, the compiler and browser filesystems,
fixed workers, independent installation pin, runner service, private HTTPS
transport, production boot and authenticated end-to-end test were still
required. No merchant code was run during that smoke test.

The v2 installation pin also binds the full `gvisor-bin` helper directory. A v1
receipt does not qualify these helpers and must not be accepted for this host.

An offline synthetic signed compile subsequently passed through the native
Linux runner with a v2 observed installation pin, gVisor networking disabled,
Node 24.21.0 for compilation, Node 24.20.0 for browser work, and no orders or
publication. The observed pin was generated on the same host and is qualification
evidence only: it is not independent release provenance or permission to activate
the runner for merchants.

A second offline synthetic run reverified the v2 installation and exercised the
signed runner's Chromium capture at widths 390 and 1440. Both returned the
expected semantic heading and PNG evidence with sandbox networking disabled;
reported job times were 31,790 ms and 32,156 ms. No orders or storefront
publication occurred. This is an offline host qualification, not live OAuth,
checkout, field performance, or independent production-image provenance.

The bundled synthetic auth-service and listener tests also passed on Contabo
as an unprivileged user with Node 24.21.0. These tests cover service lifecycle,
private socket permissions, proxy-header sanitization and issuer discovery;
they do not start a production broker or connect it to production credentials.
A separate local PostgreSQL-backed authorization-code test confirmed the real
provider returns the issuer and state on a successful callback; the upstream
identity provider in that test was simulated.

The public `mcp.usebaci.com` discovery endpoint still returned the Supabase
issuer when checked, rather than the dedicated builder issuer. Production
routing and the actual OpenAI authorization flow therefore remain unqualified;
do not treat the domain verification as evidence of a working connection.
