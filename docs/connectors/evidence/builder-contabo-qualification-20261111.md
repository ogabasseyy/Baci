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
the runner for merchants. Desktop/mobile browser capture is a separate test.
