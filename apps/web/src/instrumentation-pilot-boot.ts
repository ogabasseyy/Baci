import { join } from 'node:path';

// Merchant image pilot startup gate, extracted from instrumentation.ts
// under the repo line ceiling. Runs on every Node.js-runtime boot:
// rechecks the served public tree through the same root the build
// gate verified (never a silently wrong lookalike), banners
// production lab exposure, initializes the lab runtime fail-loud
// (refusing only on unbound staged content or ALLOW_PROD), and
// binding-checks the static namespace after a successful init.
// Separated so the OTel/quiz boot path stays readable; behavior is
// pinned by instrumentation-pilot.test.ts and
// instrumentation-pilot-degraded.test.ts through register().
export async function registerPilotStartupGate(): Promise<void> {
  // Standalone starts can reuse serialized Next config: recheck the actual
  // runtime public tree, including lab-built artifacts started with flag off.
  // The root resolves through the shared helper (config-stashed or
  // standalone-anchored) so boot inspects the same tree the build gate
  // did — never a silently wrong lookalike.
  const { assertPilotPublicAssets } = await import(
    '@/config/pilot-public-assets'
  );
  const { resolvePilotPublicDir } = await import(
    '@/config/pilot-public-assets-roots'
  );
  const { isPilotLabEnabled } = await import('@/config/pilot-lab-enabled');
  const { hasPilotIntent } = await import(
    '@/config/pilot-public-assets-unanchored'
  );
  let pilotPublicDir: string;
  try {
    pilotPublicDir = resolvePilotPublicDir();
    // Intent-gated drift: filler fixtures are synthetic, so drift
    // on a box that never opted into the pilot (deploy-pipeline
    // recompression) warns instead of bricking an unrelated
    // production boot. With pilot intent the box is a lab
    // participant and drift stays fatal (post-build tamper). Lab
    // mode always counts as intent (its flag matches the prefix).
    assertPilotPublicAssets(
      pilotPublicDir,
      undefined,
      hasPilotIntent() ? 'throw' : 'warn'
    );
  } catch (error) {
    // The catch discriminates by failure, not by message: lab mode
    // demands a verified tree and stays fatal on everything, and a
    // drift refusal from the anchored check above (any non-anchor
    // error) must propagate, never degrade — the candidates path
    // below runs ONLY for the coded anchor failure with the lab
    // off. There the helper checks every candidate root it can find
    // (detected staged content refuses under pilot intent, drift
    // refuses, strays warn); a boot that checked nothing refuses
    // when pilot env is configured (explicit
    // BACI_IMAGE_PILOT_UNANCHORED_ACK=1 degrades to a warning) and
    // warns when no pilot configuration exists at all —
    // serverless/Vercel functions structurally cannot anchor. No
    // second unconditional cwd re-check: a tree the candidates
    // deliberately excluded must not brick a boot.
    if (
      isPilotLabEnabled() ||
      !(error instanceof Error) ||
      (error as { code?: unknown }).code !== 'PILOT_PUBLIC_UNANCHORED'
    ) {
      throw error;
    }
    const { assertUnanchoredPublicTrees } = await import(
      '@/config/pilot-public-assets-unanchored'
    );
    assertUnanchoredPublicTrees();
    // Lab is off here, so the binding sections below never run.
    pilotPublicDir = join(process.cwd(), 'public');
  }
  if (isPilotLabEnabled()) {
    // Production-lab exposure banner: reaching here with
    // NODE_ENV=production means BACI_IMAGE_PILOT_ALLOW_PROD=1
    // explicitly opted this box into serving staged merchant bytes
    // as static files (no auth, predictable /__pilot/... URLs) from
    // a production build. Say so on every boot, so a copied env file
    // can never enable this silently.
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        'merchant image pilot: LAB ENABLED IN PRODUCTION (BACI_IMAGE_PILOT_ALLOW_PROD=1) — staged merchant bytes are publicly served as static files under /__pilot with no authentication. Disable the flag and remove the staged tree when measurement ends.'
      );
    }
    const { initializeLabRuntime } = await import('@/app/pilot-lab/lab-route');
    // Fail-loud, not fail-fatal (quiz gate below is the precedent):
    // the lab is one feature and must not take the storefront down.
    // A failed lab init logs loudly and skips the runtime publish,
    // so lab routes fail closed while boot completes — UNLESS staged
    // content sits under the static /__pilot namespace: Next serves
    // it without invoking lab handlers, and with no runtime there is
    // no binding set to check it against, so serving it would be
    // silent unbound exposure. That boot refuses; a fillers-only (or
    // absent) tree keeps the fail-loud behavior.
    let runtime = null;
    try {
      runtime = await initializeLabRuntime();
    } catch (error) {
      console.error(
        'merchant image pilot: lab runtime initialization failed during boot; lab routes will fail closed',
        error
      );
      // ALLOW_PROD escalates the degraded boot to fatal: with
      // production exposure acknowledged, continuing runtime-less
      // leaves direct /__pilot fetches served with NO re-check
      // until restart (static serving never invokes a lab
      // handler). Lab-dev keeps fail-loud degrade on its
      // network-isolated box.
      const { PILOT_LAB_ALLOW_PROD_FLAG } = await import(
        '@/config/pilot-lab-enabled'
      );
      if (process.env[PILOT_LAB_ALLOW_PROD_FLAG] === '1') {
        throw error;
      }
      const { assertNoUnboundStagedContent } = await import(
        '@/config/pilot-public-assets-roots'
      );
      assertNoUnboundStagedContent(pilotPublicDir);
    }
    // Static-namespace binding check, also fatal: Next serves
    // public/__pilot without invoking lab handlers, so unbound files
    // present at boot would stay publicly servable even though no lab
    // page validates them. A successful init with a drifting tree
    // refuses boot with the re-stage fix; a failed init was already
    // refused above when staged content exists, so reaching here with
    // no runtime means a fillers-only or absent tree. Residual window
    // (accepted, pinned by the plant-after-boot test): files planted
    // under __pilot AFTER boot are statically servable until the next
    // lab page render re-runs the per-request binding check — and
    // after a degraded (runtime-less) boot, every render ATTEMPT
    // still re-checks against the empty binding set and refuses
    // loudly on staged content. But DIRECT static-asset requests
    // (GET /__pilot/...) never invoke a lab handler, so a plant
    // fetched only that way is served with NO re-check until
    // restart: the "never silently" claim covers lab PAGE renders,
    // not raw asset fetches. Operate the lab (and especially
    // ALLOW_PROD) on a network-isolated host for exactly this
    // reason. Staging requires local filesystem write; anyone with
    // that access is inside the trust boundary already, but treat
    // unexpected __pilot content as a re-stage-and-restart event,
    // never a live edit.
    if (runtime) {
      const { assertNoUnexpectedStagedFiles } = await import(
        '@/lib/merchant-image-variant-pilot/lab-config-stage-guard'
      );
      const { pinnedFillerEntries } = await import(
        '@/config/pilot-public-assets'
      );
      // Filler paths ride along exactly like the request path: without
      // them the boot check never enumerates fillers/, and a fourth
      // file planted there would stay statically servable until the
      // first lab page render — indefinitely if none ever renders.
      await assertNoUnexpectedStagedFiles(
        runtime.stagedPaths,
        join(pilotPublicDir, '__pilot'),
        pinnedFillerEntries(pilotPublicDir).map((entry) => entry.path)
      );
    }
  }
}
