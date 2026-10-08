// Pure readiness verdicts: geometry equality, staged-URL identity, and the
// selected-image decode verdict. Browser collection lives in
// merchant-image-pilot-readiness.mjs; these stay unit-testable here.
import { noAvifSurfaceProblems } from './merchant-image-pilot-readiness-noavif.mjs';
import { resolutionProblems } from './merchant-image-pilot-readiness-resolution.mjs';

export {
  boxesMatch,
  crossArmProblems,
} from './merchant-image-pilot-cross-arm.mjs';

export function pilotImageUrlsOk(urls) {
  return urls.every((url) => !url.includes('/originals/'));
}

// Shared staged-image rules, labelled per surface: the element must have
// decoded (complete + nonzero natural width) from the mount's APPROVED
// byte identity — its generation URL on pilot, its exact staged original
// on control. Broad prefix checks would let a stale mounts file certify
// an unreviewed generation, or one binding serve another's original. A
// network failure or an HTML error page leaves the element in place, so
// geometry alone cannot prove the image loaded.
function servedPathname(currentSrc) {
  try {
    return new URL(currentSrc).pathname;
  } catch {
    return String(currentSrc ?? '').split('?')[0];
  }
}

function stagedImageProblems(image, arm, label, mount, dpr, options = {}) {
  if (!image) {
    return [`${label} absent`];
  }
  if (!image.complete || (image.naturalWidth ?? 0) < 1) {
    return [`${label} did not decode`];
  }
  if (!image.currentSrc) {
    return [`${label} has no source`];
  }
  const pathname = servedPathname(image.currentSrc);
  if (arm === 'pilot') {
    if (!pathname.startsWith(`/__pilot/${mount.generationId}/`)) {
      return [`pilot ${label} is not from the approved generation`];
    }
    // No-AVIF profile: the painted resource must be the WebP fallback —
    // an AVIF currentSrc means the fallback was never selected.
    if (options.expectNoAvif && pathname.endsWith('.avif')) {
      return [`pilot ${label} selected AVIF despite no-avif`];
    }
  } else if (pathname !== mount.stagedOriginal) {
    return [`control ${label} is not the approved staged original`];
  }
  return resolutionProblems(image, label, dpr);
}

// Pure verdict on the collected selected-image state.
export function selectedImageProblems(image, arm, mount, dpr, options = {}) {
  return stagedImageProblems(
    image,
    arm,
    'selected image',
    mount,
    dpr,
    options
  ).map((problem) =>
    problem
      .replace(
        'pilot selected image is not from the approved generation',
        'pilot selected is not from the approved generation'
      )
      .replace(
        'control selected image is not the approved staged original',
        'control selected is not the approved staged original'
      )
  );
}

// Per-slot mount verdict: every expected bound slot must render its bound
// section (a reporting status is not a mount), show a visible image box
// intersecting the viewport, and decode its arm-correct staged image. `slot` is the
// collected [data-pilot-lab-slot] section for the mount's binding, or
// nullish when that binding rendered nothing.
//
// Mobile-only bindings (the md:hidden hero) invert on desktop profiles:
// the slot must still render its bound section, but hidden — decode and
// URL verdicts stay with the mobile profiles that actually show it, while
// the network-level purity checks below still catch hidden original
// fetches on every profile.
export function slotMountProblems(
  slot,
  mount,
  { arm, dpr, expectHidden, expectNoAvif, viewportHeight, viewportWidth }
) {
  const label = `slot "${mount.slotId}" image`;
  if (!slot) {
    return [`slot "${mount.slotId}" mount is absent`];
  }
  if (slot.status) {
    return [`slot "${mount.slotId}" renders only "${slot.status}"`];
  }
  if (!slot.img) {
    return [`slot "${mount.slotId}" image absent`];
  }
  // Visibility and placement verdict on the MOUNT image box, never the
  // section: a slot section wraps every card in the binding (four rows
  // at the mobile one-column breakpoint) and legitimately extends below
  // the fold, while only the mount image must be visible to measure.
  const box = slot.img.box ?? {};
  const visible = (box.width ?? 0) >= 1 && (box.height ?? 0) >= 1;
  if (expectHidden) {
    if (visible) {
      return [`slot "${mount.slotId}" should be hidden on this profile`];
    }
    return [];
  }
  if (!visible) {
    return [`slot "${mount.slotId}" has no visible box`];
  }
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight)) {
    return [
      `slot "${mount.slotId}" viewport unverifiable (missing collection data)`,
    ];
  }
  if (!intersectsViewport(box, viewportWidth, viewportHeight)) {
    return [`slot "${mount.slotId}" is outside the viewport`];
  }
  return stagedImageProblems(slot.img, arm, label, mount, dpr, {
    expectNoAvif,
  });
}

// Viewport intersection on both axes (≥1px overlap each way): LCP
// eligibility needs visibility, not full containment — a partially
// visible hero is measurable, and a grid section hanging past the fold
// is scrolling, not a layout break. Zero overlap still fails: a
// fully-offscreen box decodes but the user never sees it.
function intersectsViewport(box, viewportWidth, viewportHeight) {
  const x = box.x ?? 0;
  const y = box.y ?? 0;
  const width = box.width ?? 0;
  const height = box.height ?? 0;
  const overlapX = Math.min(x + width, viewportWidth) - Math.max(x, 0);
  const overlapY = Math.min(y + height, viewportHeight) - Math.max(y, 0);
  return overlapX >= 1 && overlapY >= 1;
}

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
  if (arm === 'pilot' && !pilotImageUrlsOk(collected.imageUrls)) {
    problems.push('pilot requested a selected original');
  }
  if (
    arm === 'control' &&
    !collected.imageUrls.some((url) => url.includes('/originals/'))
  ) {
    problems.push('control requested no staged original');
  }
  for (const mount of expectedMounts) {
    const slot = (g.slots ?? []).find(
      (entry) => entry.binding === mount.binding
    );
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
  return problems;
}
