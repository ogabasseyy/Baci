# Replay artifact builder

`buildReplayArtifact` creates a fresh, self-contained Node 24 ESM artifact from
two explicitly selected roots. It does not run while imported and has no
environment, secret, database, provider, deployment, or installation behavior.

The caller must provide all three absolute or resolvable paths:

- `receiverRoot`: the receiver tree's `apps/web` directory. The fixed receiver
  entrypoint is `tools/piggyvest-staging/replay-daemon.ts`.
- `savingsRoot`: the canonical owner-selected `apps/web/src` directory. The
  fixed replay entrypoint is
  `lib/piggyvest/prefunded-card-replay-runtime.ts`.
- `outputDirectory`: a path that does not already exist.

The preparation-only CLI makes the two-worktree build repeatable:

```sh
pnpm --filter @baci/web exec tsx tools/piggyvest-staging/replay-artifact-cli/command.ts \
  --receiver-root /absolute/receiver/apps/web \
  --savings-root /absolute/savings/apps/web/src \
  --output-directory /absolute/fresh-release
```

All three flags are required exactly once. Unknown flags, duplicate source
selection and activation requests are refused before invoking the builder.
This command does not renew credentials, enable payments or start replay.

The builder emits `replay-daemon.mjs`, `prefunded-replay-bundle.mjs`, and
`replay-artifact.manifest.json`. The manifest records the resolved source roots,
fixed entrypoints and their SHA-256 digests, approved application-source inputs
from each metafile with per-file digests, and the SHA-256 digest of each bundle.

Both bundles use `platform: node`, `format: esm`, `target: node24`, and the
`react-server` condition. `pg-native` is the sole external module. `pg` remains
bundled and the artifact includes a `createRequire` banner for CommonJS support.
When `esbuild` is not directly resolvable from the receiver package, the builder
resolves `tsx/cli` from that package and resolves `esbuild` from the resulting
require context; it never installs dependencies.

Each esbuild metafile is checked so every non-dependency input remains under
`receiverRoot/tools/piggyvest-staging`, `receiverRoot/src`, or `savingsRoot`.
Virtual inputs fail closed. Every metafile output import must be a recognized
Node built-in (bare or `node:`-prefixed) or the optional `pg-native` external;
all other package, relative, and
absolute runtime imports are rejected. A bundle that contains a `/worktrees/`
path is also rejected before its manifest is written. The
receiver runtime loads only its fixed sibling with
`import(new URL('./prefunded-replay-bundle.mjs', import.meta.url).href)`; no
runtime-configurable or cross-worktree import path is part of this artifact.

If a bundle fails after the fresh output directory is created, the builder
leaves it untouched for inspection rather than deleting or replacing anything.
