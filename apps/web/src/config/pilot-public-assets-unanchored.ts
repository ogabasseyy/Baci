// Unanchored-boot handling for the merchant image pilot gate, split out
// of instrumentation.ts under the repo line ceiling. When the boot gate
// cannot anchor the public tree (no config stash, no standalone path)
// and the lab is OFF, an unrelated boot must not brick on the anchor
// failure itself — but it must not pass a served tree unseen either.
// Resolve every candidate root we can find and refuse on DETECTED
// staged content; only the anchor failure (with nothing found)
// degrades to a loud warning. Lab-ON boots never reach here: they
// demand a verified tree and stay fatal in the resolver.
// The residual "found nothing yet" state is explicit: a plant AFTER
// this boot check lands unseen in the local window, and serving it
// later would fail closed (routes + readiness pin allowlisted
// hashes) — detection at boot, not remediation of every future
// plant. Under ALLOW_PROD that local plant window is bounded only by
// operator rollback discipline (see the operations runbook), so
// shorten the collection window and clean up promptly.
import { statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { assertPilotPublicAssets } from './pilot-public-assets';

// Candidate public trees for an unanchored lab-off boot, in check
// order: the cwd tree when the cwd is plausibly the served app root
// (public/ or next.config.* present), plus the tree beside the server
// entry script (custom servers usually live next to their app, e.g.
// `node /app/server.js` serving /app). A bare cwd with a script from
// elsewhere yields no candidates — the served tree is then fully dark
// (see below), which no local probe can illuminate short of a
// filesystem scan. argv[1] absence or garbage resolves harmlessly to a
// missing dir and contributes nothing.
export function unanchoredCandidatePublicDirs(): string[] {
  const candidates: string[] = [];
  const cwd = process.cwd();
  const stats = (path: string) => {
    try {
      return statSync(path);
    } catch {
      return null;
    }
  };
  if (
    stats(join(cwd, 'public'))?.isDirectory() ||
    [
      'next.config.ts',
      'next.config.mjs',
      'next.config.js',
      'next.config.cjs',
    ].some((file) => stats(join(cwd, file))?.isFile())
  ) {
    candidates.push(join(cwd, 'public'));
  }
  const entry = process.argv[1];
  if (entry) {
    const adjacent = join(dirname(resolve(entry)), 'public');
    if (adjacent !== candidates[0] && stats(adjacent)?.isDirectory()) {
      candidates.push(adjacent);
    }
  }
  return candidates;
}

// Checks every candidate above with the shared gate (fatal on detected
// staged content, same as the anchored path) and warns loudly about
// the residual: with zero candidates nothing was checkable, and with
// candidates a custom server rooted anywhere else is still unseen.
// Never throws for the anchor failure itself — lab-off boots proceed.
export function assertUnanchoredPublicTrees(): void {
  const candidates = unanchoredCandidatePublicDirs();
  if (candidates.length === 0) {
    console.warn(
      'merchant image pilot: startup gate cannot anchor the public tree and found no checkable app tree (bare cwd, no server-adjacent public/); continuing unchecked — staged content elsewhere would be served unverified. Set BACI_PILOT_PUBLIC_DIR to silence this.'
    );
  } else {
    console.warn(
      `merchant image pilot: startup gate cannot anchor the public tree; checked ${candidates.length} candidate tree(s) instead — a custom server rooted elsewhere would be unseen. Set BACI_PILOT_PUBLIC_DIR to silence this.`
    );
  }
  for (const candidate of candidates) {
    assertPilotPublicAssets(candidate);
  }
}
