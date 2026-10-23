# Exact proposed staging scope

This is a preparation record, not evidence of a deployment.

**Latest owner decision: keep staging local and use a local database.** Use the installed PostgreSQL17.11 binary in isolated Unix-socket fixtures; create no paid Supabase project, remote service, DNS record or credential. Remote details below are retained as an unprovisioned proposal only.

- VPS: `bassey@82.29.190.219`, new root `/home/bassey/baci-builder-staging` only.
- New DNS/TLS: `builder-staging.usebaci.com` (web), `builder-auth-staging.usebaci.com` (OAuth), `builder-mcp-staging.usebaci.com` (MCP `/builder/mcp`), `*.builder-sites-staging.usebaci.com` (disposable stores). Verify ownership/availability before creating records.
- Separate loopback listeners: web18890, auth18891, MCP18892; separate systemd identities/services for auth, MCP, edit runner and verifier. Verify ports and service names are unoccupied immediately before installation.
- New disposable Supabase project `baci-builder-staging`, region `eu-west-1`; owner selected the Baci organization (`rywjlzuhibxdfmtvdzrf`). Supabase quotes $10/month; owner declined the paid project in favor of local staging. Do not create it. Existing Baci production project and Scribe project are forbidden targets. Synthetic owner/store/catalog only; no production account, shopper, order or payment copy.
- Separate outer signing/cookie/vault keys, dedicated upstream OAuth client and exact new developer-connection callback, private auth-storage role, INSERT-only verifier role. Normal authenticated owner RLS sessions perform business operations. Secrets stay in restricted VPS credential files; no values in evidence, code or logs.
- Replay the full compatible schema and this branch's twelve builder migrations in exact hash order in the disposable database. Keep flags off until compatibility and raw Data API privacy qualification pass; invoke privacy contraction explicitly only after its gates. Do not apply anything to production.
- Web environment declarations/bootstrap, canonical deployment-profile plumbing and staging-only flags require changes before deployment. They must resolve every auth/gateway/approval/publication URL to staging; string replacement or production-host aliases are unacceptable.
- Deployment uses the approved VPS flow only. No `vercel build`, cloud build, production promotion, existing process restart, database copy, submission change, or public app creation is included.

## Current preflight

Read-only SSH confirms VPS reachable, 6.2GB free (97% used). A complete new web build plus retained rollback artifacts cannot yet be qualified within this budget. No cache removal or shared Docker restart is authorized by this scope. Local PostgreSQL17.11 and PostgREST16.4 fixtures are healthy and have passed the local RLS and signed-token HTTP checks. Docker remains unavailable, so pinned GoTrue/full Supabase, full-schema cutover and real-host qualification remain pending.

## Dormant remote proposal conditions

These conditions apply only if the owner later reauthorizes remote provisioning. The selected Baci organization is recorded above; the quoted paid project was declined. A new provider cost acceptance would be required. Resolve disk budget; prove staging host/profile isolation and actual web runtime composition; obtain Codex review on the exact candidate. Then show the final SHA/artifact hashes and provision only this scope. Existing Ogabassey/OpenAI and Muse submissions stay untouched throughout.
