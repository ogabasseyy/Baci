// Per-slot mount verdicts for the merchant image pilot readiness gate:
// the selected-image and slot-mount checks shared staged-image rules
// live here. Split from merchant-image-pilot-readiness-checks.mjs under
// the repo line ceiling.
import { servedPathname } from './merchant-image-pilot-readiness-purity.mjs';
import { resolutionProblems } from './merchant-image-pilot-readiness-resolution.mjs';

// Shared staged-image rules, labelled per surface: the element must have
// decoded (complete + nonzero natural width) from the mount's APPROVED
// byte identity — its generation URL on pilot, its exact staged original
// on control. Broad prefix checks would let a stale mounts file certify
// an unreviewed generation, or one binding serve another's original. A
// network failure or an HTML error page leaves the element in place, so
// geometry alone cannot prove the image loaded.
function stagedImageProblems(image, arm, label, mount, dpr, options = {}) {
  if (!image) {
    return [`${label} absent`];
  }
  // Control descriptors are requested labels, not physical widths: when
  // collection could not derive the width from the decoded staged
  // bytes, neither the label nor the density-corrected naturals are
  // trustworthy, so resolution is unverifiable instead of assured.
  if (image.controlBytesUnverified) {
    return [
      `${label} control resolution unverifiable (staged bytes unreadable)`,
    ];
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
// the network-level purity checks still catch hidden original fetches on
// every profile.
export function slotMountProblems(
  slot,
  mount,
  { arm, dpr, expectHidden, expectNoAvif, viewportHeight, viewportWidth }
) {
  const label = `slot "${mount.slotId}" image`;
  if (!slot) {
    return [`slot "${mount.slotId}" mount is absent`];
  }
  // Binding identity alone never suffices: a mount measured under the
  // wrong slot inherits geometry and crop that were not accepted for
  // it, so the section slot must equal the accepted slot exactly.
  if (slot.slotId !== mount.slotId) {
    return [
      `slot "${mount.slotId}" mount renders under slot "${slot.slotId ?? 'unslotted'}" (binding/slot mismatch)`,
    ];
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
export function intersectsViewport(box, viewportWidth, viewportHeight) {
  const x = box.x ?? 0;
  const y = box.y ?? 0;
  const width = box.width ?? 0;
  const height = box.height ?? 0;
  const overlapX = Math.min(x + width, viewportWidth) - Math.max(x, 0);
  const overlapY = Math.min(y + height, viewportHeight) - Math.max(y, 0);
  return overlapX >= 1 && overlapY >= 1;
}
