// Unanchored-boot handling for the merchant image pilot gate, split out
// of instrumentation.ts under the repo line ceiling. When the boot gate
// cannot anchor the public tree (no config stash, no standalone path)
// and the lab is OFF, an unrelated boot must not brick on the anchor
// failure itself — but it must not pass a served tree unseen either.
// Resolve every candidate root we can find: detected staged content
// refuses under pilot intent (same as the anchored path) and warns
// without it, and only the anchor failure with nothing found degrades
// to a loud warning. Lab-ON boots never reach here: they demand a
// verified tree and stay fatal in the resolver.
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

// Checks every candidate above with the shared gate and warns loudly
// about the residual: with zero candidates nothing was checkable, and
// with candidates a custom server rooted anywhere else is still
// unseen. Never throws for the anchor failure itself — lab-off boots
// proceed. Detected staged content in a candidate refuses when the
// operator shows pilot intent (the box is a lab participant; same as
// the anchored path) and warns without it (a foreign tree that may
// belong to a live lab session elsewhere — never mutated, never
// quarantined). Explicit opt-in for passing a boot the gate could not
// check at all: without it a custom server rooted elsewhere serves
// its real public/__pilot tree completely unverified in non-lab
// mode. Strict '1', matching the lab-flag convention; detected staged
// content refuses regardless of this flag when intent is configured.
export const PILOT_UNANCHORED_ACK_FLAG = 'BACI_IMAGE_PILOT_UNANCHORED_ACK';

// Pilot intent: any non-empty BACI_IMAGE_PILOT_* var (or the gate's own
// stash). A process with zero pilot configuration — Vercel/serverless
// functions, migrations, workers — has nothing to do with the pilot,
// so an unanchorable lab-off boot there warns; a process the operator
// DID configure for the pilot but that cannot anchor is a loud
// misconfiguration and refuses. This keeps the lab-off fail-closed
// without bricking unrelated production boots.
export function hasPilotIntent(): boolean {
  return Object.keys(process.env).some(
    (key) =>
      (key.startsWith('BACI_IMAGE_PILOT') || key === 'BACI_PILOT_PUBLIC_DIR') &&
      (process.env[key] ?? '') !== ''
  );
}

export function assertUnanchoredPublicTrees(): void {
  const candidates = unanchoredCandidatePublicDirs();
  if (candidates.length === 0) {
    // This boot checked NOTHING. Fail closed when the operator shows
    // pilot intent (explicit ack degrades to a warning); warn when no
    // pilot configuration exists at all — serverless/Vercel functions
    // and unrelated workers structurally cannot anchor, and a lab-only
    // feature must not brick them. (The candidates-found branch below
    // DID check the plausible trees, so its narrower residual keeps
    // the plain warning.)
    if (process.env[PILOT_UNANCHORED_ACK_FLAG] === '1') {
      console.warn(
        'merchant image pilot: startup gate cannot anchor the public tree and found no checkable app tree (bare cwd, no server-adjacent public/); continuing unchecked under BACI_IMAGE_PILOT_UNANCHORED_ACK=1 — staged content elsewhere would be served unverified.'
      );
    } else if (hasPilotIntent()) {
      throw new Error(
        'merchant image pilot: startup gate cannot anchor the public tree and found no checkable app tree (bare cwd, no server-adjacent public/); refusing an unchecked boot — set BACI_PILOT_PUBLIC_DIR to the served tree, or BACI_IMAGE_PILOT_UNANCHORED_ACK=1 to acknowledge the unchecked residual'
      );
    } else {
      console.warn(
        'merchant image pilot: startup gate cannot anchor the public tree and found no checkable app tree (bare cwd, no server-adjacent public/); no pilot configuration detected, continuing unchecked — set BACI_PILOT_PUBLIC_DIR if this process serves the app tree.'
      );
    }
  } else {
    console.warn(
      `merchant image pilot: startup gate cannot anchor the public tree; checked ${candidates.length} candidate tree(s) instead — a custom server rooted elsewhere would be unseen. Set BACI_PILOT_PUBLIC_DIR to silence this.`
    );
  }
  // Intent-gated drift: filler fixtures are synthetic, so drift on a
  // box that never opted into the pilot (deploy-pipeline
  // recompression, smudged checkout) warns instead of bricking an
  // unrelated migration or worker. With pilot intent the box is a
  // lab participant and drift stays fatal (post-build tamper).
  const intent = hasPilotIntent();
  const fillerDrift = intent ? 'throw' : 'warn';
  // Detected staged-merchant shapes refuse under intent (a lab
  // participant serving an unverified candidate must not boot) and
  // warn without it (an unrelated migration or worker that merely
  // runs near an app dir must not brick). Strays warn in both modes
  // (the triage downgrades them itself); nothing here quarantines.
  const contentFindings = intent ? 'throw' : 'warn';
  for (const candidate of candidates) {
    // No quarantine here: a candidate is a FOREIGN tree that may
    // belong to a live lab session elsewhere on the box, and this
    // process must not mutate it. The zero-candidate refusal above
    // is unchanged: checking nothing under pilot intent stays fatal.
    assertPilotPublicAssets(
      candidate,
      undefined,
      fillerDrift,
      contentFindings,
      false
    );
  }
}
