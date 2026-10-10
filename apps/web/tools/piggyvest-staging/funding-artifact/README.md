# Funding artifact: snapshot, package, placement

Reproducible pipeline from worktree source to the installed
`/opt/baci-savings-funding` tree. No step starts, enables, or reloads
anything; no step reads secrets.

## 1. Snapshot (unprivileged, build machine)

`snapshot-funding-source.py create --root <worktree> --out <dir>` captures
tracked plus untracked (non-ignored) files, excluding scratch
(`__pycache__`, `.playwright-cli`), and refuses any `.env` file even when
tracked. Output: `funding-source-<date>.tar.gz` plus a SHA-256 manifest.

Verify after transfer with `snapshot-funding-source.py verify --tarball
--manifest --tree`; every file hash must match.

## 2. Build (unprivileged, VPS)

Extract the verified snapshot, then from the snapshot root:

- `pnpm install --frozen-lockfile`
- `PIGGYVEST_HOSTED_DRAFT_STANDALONE_BUILD=true pnpm --filter @baci/web build:ci`

The standalone flag is required: without it no `standalone/` output is
emitted. Smoke the result on loopback with synthetic funding-profile
values before packaging.

## 3. Package (unprivileged, VPS)

`package-funding-deploy.py --build-web <snapshot>/apps/web --out <dir>`
arranges `standalone/*` plus the `.next/static` and `public` overlays into
the fixed deploy layout (`apps/web/server.js`, `apps/web/public`,
`apps/web/.next/static`, `node_modules`), refuses missing or `.env`
inputs, and writes the deploy tarball plus manifest with pins.

## 4. Placement (owner root, one command)

`install-funding-artifact.py --install` runs from a root-owned staging
directory holding the deploy tarball, manifest, and funding-service
candidate. It hash-verifies all three against embedded pins, re-verifies
every manifest entry, stages under `/opt` with explicit root ownership
and modes, renames atomically, and proves the result with the
candidate's own artifact verification. Fresh installs only; on any
failure the target is absent, never partial.
