// Pure surface verdict for the merchant image pilot readiness gate. The
// per-slot mount verdicts live in
// merchant-image-pilot-readiness-mounts.mjs, the network purity checks in
// merchant-image-pilot-readiness-purity.mjs; this module keeps the
// surface composer. Browser collection lives in
// merchant-image-pilot-readiness.mjs; these stay unit-testable here.
import { unexpectedMountProblems } from './merchant-image-pilot-readiness-coverage.mjs';
import {
  intersectsViewport,
  selectedImageProblems,
  slotMountProblems,
} from './merchant-image-pilot-readiness-mounts.mjs';
import { noAvifSurfaceProblems } from './merchant-image-pilot-readiness-noavif.mjs';
import {
  controlImageUrlViolation,
  pilotImageUrlViolation,
  servedPathname,
} from './merchant-image-pilot-readiness-purity.mjs';

export {
  boxesMatch,
  crossArmProblems,
} from './merchant-image-pilot-cross-arm.mjs';

// Pure verdict on one collected surface: console/request hygiene, style
// delivery, heading invisibility, the primary selected slot, arm URL
// purity, and — for every expected bound slot — mount coverage. Moving
// this out of the Playwright driver keeps the gate unit-testable and the
// driver under the repo line ceiling.
export function surfaceProblems(
  collected,
  {
    arm,
    expectHiddenMounts,
    expectNoAvif,
    expectedFit,
    expectedMounts,
    surface,
  }
) {
  const problems = [];
  if (collected.consoleErrors.length > 0) {
    problems.push(`console errors: ${collected.consoleErrors.join(' | ')}`);
  }
  if (collected.failedRequests.length > 0) {
    problems.push(`failed requests: ${collected.failedRequests.join(' | ')}`);
  }
  // No-AVIF fallback proof (pilot arm) plus per-image non-AVIF
  // selection below.
  if (expectNoAvif) {
    problems.push(...noAvifSurfaceProblems(collected, arm));
  }
  const g = collected.geometry;
  if (g.stylesheetCount < 1 || g.stylesheetBytes < 1) {
    problems.push('no stylesheet delivered');
  }
  if (!g.heading || g.heading.width > 1 || g.heading.height > 1) {
    problems.push('sr-only heading occupies visible space');
  }
  if (!g.selected) {
    problems.push('selected slot absent');
  } else if (
    !Number.isFinite(g.viewportWidth) ||
    !Number.isFinite(g.viewportHeight)
  ) {
    problems.push(
      'selected slot viewport unverifiable (missing collection data)'
    );
  } else if (
    // Hidden primary surfaces (desktop hero) have no measurable box: like
    // decode below, the geometric verdict is vacuous and the per-mount
    // hidden assertions own this profile. Presence/collection hygiene
    // above still apply.
    !expectHiddenMounts &&
    !intersectsViewport(g.selected, g.viewportWidth, g.viewportHeight)
  ) {
    problems.push('selected slot is outside the viewport');
  }
  if (surface === 'grid' && g.gridDisplay !== 'grid') {
    problems.push(`grid display is ${g.gridDisplay ?? 'missing'}`);
  }
  if (g.imgObjectFit !== expectedFit) {
    problems.push(
      `selected image object-fit is ${g.imgObjectFit ?? 'missing'}, expected ${expectedFit}`
    );
  }
  // A hidden primary surface (desktop hero) cannot prove element decode;
  // the mobile profiles own that verdict. Network-level purity below
  // still applies: hidden images fetch, so a pilot original fetch fails
  // on every profile.
  if (!expectHiddenMounts) {
    // The primary surface is one of the expected mounts (hero slot on
    // hero surfaces, product card on grids): its identity pins the
    // selected-image verdict, and a mounts file without it covers
    // nothing the gate can certify.
    const primarySlotId =
      surface === 'hero' ? 'mobile-hero-slide-0' : 'product-card';
    const primary = expectedMounts.find(
      (mount) => mount.slotId === primarySlotId
    );
    if (!primary) {
      problems.push(`selected slot "${primarySlotId}" has no expected mount`);
    } else {
      problems.push(
        ...selectedImageProblems(
          g.selectedImg,
          arm,
          primary,
          g.devicePixelRatio,
          {
            expectNoAvif,
          }
        )
      );
    }
  }
  // Network-level purity (both arms, hidden primaries included — hidden
  // images still fetch): every fetched image must come from the approved
  // mount identities or the frozen filler/icon sets. Per-image verdicts
  // pin the bound slots, but only this catches an EXTRA unmarked fetch —
  // a stale generation, a foreign original, pilot bytes on control.
  if (arm === 'pilot') {
    const violation = pilotImageUrlViolation(
      collected.imageUrls,
      expectedMounts.map((mount) => mount.generationId)
    );
    if (violation !== undefined) {
      problems.push(
        violation.includes('/originals/')
          ? 'pilot requested a selected original'
          : `pilot requested an image outside the approved generation: ${servedPathname(violation).slice(0, 200)}`
      );
    }
  }
  if (arm === 'control') {
    const violation = controlImageUrlViolation(
      collected.imageUrls,
      expectedMounts.map((mount) => mount.stagedOriginal)
    );
    if (violation !== undefined) {
      problems.push(
        `control requested an image outside the approved staged set: ${servedPathname(violation).slice(0, 200)}`
      );
    }
  }
  // The non-vacuous-control check cannot apply to hidden primaries: a
  // display:none or media-gated hero correctly fetches nothing, which is
  // indistinguishable from a broken control — the per-mount hidden
  // assertions own this profile instead.
  if (
    arm === 'control' &&
    !expectHiddenMounts &&
    !collected.imageUrls.some((url) => url.includes('/originals/'))
  ) {
    problems.push('control requested no staged original');
  }
  for (const mount of expectedMounts) {
    // First-match lookup would let a duplicate section alter layout or
    // issue extra requests while the valid twin satisfies the verdict.
    const matches = (g.slots ?? []).filter(
      (entry) => entry.binding === mount.binding
    );
    if (matches.length > 1) {
      problems.push(
        `slot "${mount.slotId}" renders ${matches.length} sections for one binding (duplicate mount)`
      );
      continue;
    }
    const slot = matches[0] ?? null;
    problems.push(
      ...slotMountProblems(slot, mount, {
        arm,
        dpr: g.devicePixelRatio,
        expectHidden: expectHiddenMounts,
        expectNoAvif,
        viewportHeight: g.viewportHeight,
        viewportWidth: g.viewportWidth,
      })
    );
  }
  problems.push(...unexpectedMountProblems(g.slots, expectedMounts));
  return problems;
}
