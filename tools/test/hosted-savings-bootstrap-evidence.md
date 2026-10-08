# Local rehearsal receipt — 2026-09-13

Outcome: BLOCKED BEFORE DATABASE CREATION. No fresh schema replay result exists.

Commands run from /Users/mac/Baci-worktrees/cursor-savings-phase1:

```sh
pnpm --dir apps/web exec tsx ../../tools/test/hosted-savings-bootstrap-cli.ts --plan
pnpm --dir apps/web exec tsx ../../tools/test/hosted-savings-bootstrap-cli.ts --fresh-disposable-local
pnpm --dir apps/web exec tsx --test '../../tools/test/hosted-savings-bootstrap*.test.ts'
```

Plan exited 0: bootstrapCount=125, historicalCountIncludingBootstrap=427,
postReplayCount=12, pendingCount=738, resumeSupported=false;
firstSource=supabase/migrations/20260418000000_baseline.sql.

Initial fresh attempt rejected before worker launch: /var/run/docker.sock is a
broken link to the absent Docker Desktop socket. Active context is colima with
unix:///Users/mac/.colima/default/docker.sock. The launcher now validates that
specific local Unix endpoint and revalidates it in the sanitized worker; SSH/TCP
and arbitrary sockets remain rejected. No production replay guard was changed.

Owner's subsequent low-disk warning was verified with df: /System/Volumes/Data
has 5.3 GiB available at 99% capacity. The new capacity preflight's fresh attempt
exited 1 with exactly:
`Local replay requires at least 20 GiB free; no resources started`.
No heavy replay or download was attempted after that warning.

Required engine image (the engine starts DB only, not Auth/REST):
public.ecr.aws/supabase/postgres:17.6.1.106 is present locally with image ID
sha256:21ab971149317ea9cd12a8126fe4ebb34def08c8972956b0958cba0924409dab.
Read-only tool version probes match the existing contract: pnpm 11.7.0,
TypeScript 7.0.2, Supabase CLI 2.95.4, psql 18.3. Server version and SQL compatibility
were not exercised. Existing Auth/REST images are not prerequisites of this runner.

Twelve focused tests passed, including local Colima socket acceptance, rejection
of remote/missing/non-socket endpoints, low-disk rejection, exact capacity boundary,
fresh-only arguments, invalid manifest/prefix, and failure without resume.
An initial socket test failed on macOS Unix-socket path length; its owned test
directory was shortened to /tmp and all tests then passed.

Root pnpm turbo lint passed. Root pnpm turbo typecheck failed on concurrently
changed, out-of-scope apps/mobile-storefront/lib/hosted-storefront-fetch.test.ts:114
(TS2322, fixture header union contains optional undefined values). Left untouched.
Scoped Biome has no errors and retains the previously disclosed DOCKER_HOST
Turbo environment-declaration warning; no inline suppression was added.

Read-only Docker container/volume/network inventories filtered to baci_replay_
were empty before and after. No replay resource was created, so owned cleanup
required no Docker deletion. Temporary socket-test directories were removed by
their own finally blocks. No phone-stack mutations, image deletion, remote DB
reads, secrets capture, schema changes or deployments occurred.

SHA-256 receipt (source bytes after tests):

```text
e2874185dcafa855f1d0c1b40766061546808a081886d4bfdb2be21f649b06e9 hosted-savings-bootstrap.ts
109b40050bd19d46dfc5ec4461234d7a1a636eaf12696f8daa3f4094af0894a0 hosted-savings-bootstrap-cli.ts
2cf4a0926d25e15349a7a8e613f0d1853c215904271c9a9554a49d61978f86d9 hosted-savings-bootstrap-worker.ts
5c5d3c4e219dcd4d27a2be3e347e794f96cc57d8015cbacda9a9569cd9678d22 hosted-savings-bootstrap-docker.ts
881a1b382e1ea7e39fd1bb0361881a94586afe6825681a45957bfb7a50f5a4cf hosted-savings-bootstrap-capacity.ts
d885e0ab50aac24d75d745bf0e1a2cfd04024f62892665bb1c5f8c118259a153 20260913130000_customer_savings_canonical_binding.sql
29dabfca95e321518e1e37dd5fb9028e7034a4296bd4e122e6f88aba47cb5e78 20260913140000_customer_savings_canonical_isolation.sql
```

The source hashes are not evidence of completed SQL replay. Keep the local
headroom gate; any future VPS rehearsal requires a separately reviewed deployment
boundary and cannot be obtained by passing a remote endpoint to this runner.
