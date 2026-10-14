import { readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Runtime public-dir resolution, shared by the build gate (next.config.ts)
// and the boot gate (instrumentation.ts): both must inspect the SAME
// tree. The build gate anchors to the config file; the boot gate cannot
// (it has no config-relative anchor at runtime), so the config stashes
// its resolved root in the environment it shares with the boot process.
// Standalone boots may reuse serialized config without evaluating
// next.config.ts: there the server script's own directory is Next's app
// root, detected via Next's standalone marker. A custom server with an
// inline conf object and a cwd outside the app dir defeats every
// anchor — that boot fails closed in resolvePilotPublicDir below.
export function resolveRoutePublicDir(): string {
  // Request-path twin of resolvePilotPublicDir below: the build/boot
  // gate inspects the tree stashed in BACI_PILOT_PUBLIC_DIR while the
  // lab routes historically read BACI_IMAGE_PILOT_PUBLIC_DIR. When both
  // are set they must resolve to the SAME tree, or the gate and the
  // request verifier inspect different directories (one passing while
  // the other serves different bytes). Explicit route var wins; the
  // fallback is the same standalone-aware resolution the gate uses
  // (stashed root, else the tree beside the standalone server, else
  // cwd/public) — never a bare cwd/public that would diverge from the
  // gate on a standalone cold start. Empty counts as unset everywhere,
  // so '' never resolves '__pilot' against ''. The route resolver keeps
  // a cwd fallback where the gate throws: every lab request re-verifies
  // bindings against this tree (verifyStagedBytes fails on anything but
  // the expected hashes), so a wrong tree fails closed per request
  // instead of passing silently at boot.
  const explicit = process.env.BACI_IMAGE_PILOT_PUBLIC_DIR || null;
  // The fallback is the same standalone-aware resolution the gate uses;
  // the agreement check only runs against an ANCHORED gate root
  // (stashed or standalone-server-anchored). A bare cwd/public legacy
  // fallback is not a verified tree, so an explicit route var without
  // any gate root stays trusted (the lab dev flow), as before.
  const gateRoot = gateVerifiedRoot();
  if (
    explicit &&
    gateRoot &&
    canonicalDir(explicit) !== canonicalDir(gateRoot)
  ) {
    throw new Error(
      'merchant image pilot: BACI_IMAGE_PILOT_PUBLIC_DIR disagrees with the build-gate public dir; refusing to serve from an unverified tree'
    );
  }
  return explicit || gateRoot || join(process.cwd(), 'public');
}

// Canonical spelling for tree-identity comparison: lexical resolve()
// treats a symlinked ancestor (/var/...) and its physical spelling
// (/private/var/...) as different trees. Missing paths fall back to
// lexical (nothing to canonicalize yet). Shared with the build gate,
// which must refuse a preset naming a different tree than the
// config-anchored one it just verified.
export function canonicalDir(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

// The gate's anchored public root, shared by the gate and the route
// resolver so both sides agree: the stashed verified tree, else the
// tree beside the standalone server. Null when neither anchors — the
// legacy cwd/public fallback is not an anchored root.
function gateVerifiedRoot(): string | null {
  const stashed = process.env.BACI_PILOT_PUBLIC_DIR;
  if (stashed) {
    return stashed;
  }
  if (process.env.__NEXT_PRIVATE_STANDALONE_CONFIG && process.argv[1]) {
    // resolve: argv[1] may be invoked relative; the gate needs absolute.
    // realpath first: a symlinked server entry would otherwise anchor
    // the gate to the link directory's public/ (absent → pass) while
    // Next serves the target directory's tree. Falls back to the
    // lexical path when nothing exists there (tests, dry runs).
    let entry = resolve(process.argv[1]);
    try {
      entry = realpathSync(entry);
    } catch {
      // keep the lexical path
    }
    return join(dirname(entry), 'public');
  }
  return null;
}

export function resolvePilotPublicDir(): string {
  // Fail closed, never cwd: the boot gate inspects this tree while Next
  // serves the real app public tree — a server started from another cwd
  // (custom server, process manager) would otherwise inspect an
  // empty/wrong tree and pass while staged files stay servable. Every
  // first-party flow anchors: next dev/build/start evaluate the config
  // in-process (which stashes the root), and standalone boots anchor to
  // the server script. Only a config-less custom server lands here, and
  // that boot must say which tree it serves.
  const anchored = gateVerifiedRoot();
  if (!anchored) {
    // Coded (not just messaged): the boot gate catches ONLY this
    // failure for its unanchored-candidates path — a staged-content
    // refusal from the check below must propagate, never degrade.
    const error = new Error(
      'merchant image pilot: cannot anchor the public tree for the startup gate (no config-stashed root, no standalone server path); refusing to inspect an unverified cwd/public — start via next dev/start so next.config stashes the root, or set BACI_PILOT_PUBLIC_DIR'
    ) as Error & { code: string };
    error.code = 'PILOT_PUBLIC_UNANCHORED';
    throw error;
  }
  return anchored;
}

// Init-failure twin of the inventory binding check: lab runtime
// initialization failed, so no stagedPaths exist to bind against — but
// Next still serves public/__pilot statically. Any entry other than
// the synthetic fillers is unbound servable content and refuses boot;
// a fillers-only (or absent/empty) tree keeps the fail-loud behavior,
// since nothing merchant is served. The shape gate already ran before
// init, so this is a coarse content check, not a re-validation.
export function assertNoUnboundStagedContent(publicDir: string): void {
  const root = join(publicDir, '__pilot');
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch (error) {
    // Fail closed: files beneath a searchable-but-unreadable tree are
    // still fetchable by known pathname, so only a genuinely absent
    // tree passes — every other listing error propagates.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const unbound = entries.filter((entry) => entry !== 'fillers');
  if (unbound.length > 0) {
    throw new Error(
      `merchant image pilot: lab runtime failed to initialize with ${unbound.length} unbound ${unbound.length === 1 ? 'entry' : 'entries'} under __pilot; refusing to serve unverified bytes — fix the initialization error above, re-run pnpm pilot:stage, or remove the staged tree`
    );
  }
}
