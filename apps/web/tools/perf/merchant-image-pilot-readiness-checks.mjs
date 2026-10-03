// Pure readiness verdicts: geometry equality, staged-URL identity, and the
// selected-image decode verdict. Browser collection lives in
// merchant-image-pilot-readiness.mjs; these stay unit-testable here.

// Rounded-box equality: identical DOM + identical CSS must lay out
// identically. Rounding absorbs subpixel serialization, nothing more.
export function boxesMatch(left, right) {
  for (const key of ['x', 'y', 'width', 'height']) {
    if (Math.round(left[key]) !== Math.round(right[key])) {
      return false;
    }
  }
  return true;
}

export function pilotImageUrlsOk(urls) {
  return urls.every((url) => !url.includes('/originals/'));
}

// Shared staged-image rules, labelled per surface: the element must have
// decoded (complete + nonzero natural width) from a staged URL of the
// expected arm. A network failure or an HTML error page leaves the element
// in place, so geometry alone cannot prove the image loaded.
function stagedImageProblems(image, arm, label) {
  if (!image) {
    return [`${label} absent`];
  }
  if (!image.complete || (image.naturalWidth ?? 0) < 1) {
    return [`${label} did not decode`];
  }
  if (!image.currentSrc) {
    return [`${label} has no source`];
  }
  if (arm === 'pilot') {
    if (
      image.currentSrc.includes('/originals/') ||
      !image.currentSrc.includes('/__pilot/')
    ) {
      return [`pilot ${label} is a non-staged image URL`];
    }
  } else if (!image.currentSrc.includes('/originals/')) {
    return [`control ${label} is no staged original`];
  }
  return [];
}

// Pure verdict on the collected selected-image state.
export function selectedImageProblems(image, arm) {
  return stagedImageProblems(image, arm, 'selected image').map((problem) =>
    problem
      .replace(
        'pilot selected image is a non-staged image URL',
        'pilot selected a non-staged image URL'
      )
      .replace(
        'control selected image is no staged original',
        'control selected no staged original'
      )
  );
}

// Per-slot mount verdict: every expected bound slot must render its bound
// section (a reporting status is not a mount), occupy a visible box inside
// the viewport, and decode its arm-correct staged image. `slot` is the
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
  { arm, expectHidden, viewportWidth }
) {
  const label = `slot "${mount.slotId}" image`;
  if (!slot) {
    return [`slot "${mount.slotId}" mount is absent`];
  }
  if (slot.status) {
    return [`slot "${mount.slotId}" renders only "${slot.status}"`];
  }
  const rect = slot.rect ?? {};
  const visible = (rect.width ?? 0) >= 1 && (rect.height ?? 0) >= 1;
  if (expectHidden) {
    if (visible) {
      return [`slot "${mount.slotId}" should be hidden on this profile`];
    }
    return [];
  }
  if (!visible) {
    return [`slot "${mount.slotId}" has no visible box`];
  }
  if ((rect.x ?? 0) + (rect.width ?? 0) > (viewportWidth ?? 0) + 1) {
    return [`slot "${mount.slotId}" overflows the viewport`];
  }
  return stagedImageProblems(slot.img, arm, label);
}

// Pure verdict on one collected surface: console/request hygiene, style
// delivery, heading invisibility, the primary selected slot, arm URL
// purity, and — for every expected bound slot — mount coverage. Moving
// this out of the Playwright driver keeps the gate unit-testable and the
// driver under the repo line ceiling.
export function surfaceProblems(
  collected,
  { arm, expectHiddenMounts, expectedFit, expectedMounts, surface }
) {
  const problems = [];
  if (collected.consoleErrors.length > 0) {
    problems.push(`console errors: ${collected.consoleErrors.join(' | ')}`);
  }
  if (collected.failedRequests.length > 0) {
    problems.push(`failed requests: ${collected.failedRequests.join(' | ')}`);
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
  } else if (g.selected.x + g.selected.width > g.viewportWidth + 1) {
    problems.push('selected slot overflows the viewport');
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
    problems.push(...selectedImageProblems(g.selectedImg, arm));
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
        expectHidden: expectHiddenMounts,
        viewportWidth: g.viewportWidth,
      })
    );
  }
  return problems;
}

// Cross-arm verdict: the primary selected slot must lay out identically,
// and so must every expected bound slot — a logo that shifts between arms
// is a layout mismatch even when the product card matches.
export function crossArmProblems(left, right, expectedMounts) {
  if (!left || !right || !left.selected || !right.selected) {
    return ['missing geometry for cross-arm comparison'];
  }
  const problems = [];
  if (
    !boxesMatch(left.selected, right.selected) ||
    (left.heading && right.heading && !boxesMatch(left.heading, right.heading))
  ) {
    problems.push('selected-slot boxes differ between arms');
  }
  for (const mount of expectedMounts) {
    const l = (left.slots ?? []).find(
      (entry) => entry.binding === mount.binding
    );
    const r = (right.slots ?? []).find(
      (entry) => entry.binding === mount.binding
    );
    if (!l?.rect || !r?.rect) {
      problems.push(
        `slot "${mount.slotId}" missing geometry for cross-arm comparison`
      );
    } else if (!boxesMatch(l.rect, r.rect)) {
      problems.push(`slot "${mount.slotId}" boxes differ between arms`);
    }
  }
  return problems;
}
