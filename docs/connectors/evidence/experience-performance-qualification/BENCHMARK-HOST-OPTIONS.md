# Benchmark host options

The developer Mac is not a required benchmark host. Its existing Colima VM shares CPU, memory and storage with local builds, so it cannot provide an independent lab while the Mac is heavily loaded. Browser throttling does not remove host contention.

Preferred no-new-spend arrangement: another already-owned, otherwise quiet Linux machine. Use at least two dedicated CPU cores (four preferred), 4–8 GB RAM, pinned browser/container versions, one sample at a time and fixed documented mobile/desktop profiles. Preserve the current load gate and raw failed/contaminated samples. A dedicated existing private remote host is another option after the owner authorizes that destination and isolation; a container alone does not reserve host resources.

The synthetic application, PostgreSQL17/PostgREST, normal auth/RLS and local quota store should run together on that host, bound only to loopback. The browser runs there too: do not tunnel the application back to the busy Mac for the benchmark. Copy the exact current-main source plus the task patch privately, retain its hashes, and run the same four routes at both widths with three cold samples per cell. Keep arbitrary custom code inside its existing sandbox. No public URL, deployment, real catalog, service-role bypass, provider keys, order submission or payment is necessary.

Read-only GitHub inspection on 2026-10-26 found the CWV Runner Attestation workflow active, but no registered runner with the baci-cwv-measurement label. The two registered runners were baci-android (busy) and baci-deploy (idle). This is not authorization or evidence of capacity to repurpose either runner. The production deployment host must not be treated as a spare benchmark host.

Free shared CI can support regression diagnostics, but shared hardware can still vary. It is not automatically equivalent to a dedicated lab. PageSpeed Insights cannot directly reach the unpublished localhost fixture. Public tunnels or publishing the preview are outside the current scope.

Current authorization remains local-only; no external runner has been provisioned, changed or used. Moving execution to a private remote host requires the user's authorization and an identified destination. A second local machine requires access details and a separate setup check.

Primary guidance: https://github.com/GoogleChrome/lighthouse/blob/main/docs/variability.md
