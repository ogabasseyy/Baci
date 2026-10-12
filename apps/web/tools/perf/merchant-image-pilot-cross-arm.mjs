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
    // Binding AND slot: comparing a binding rendered under different
    // slots across arms would equate unaccepted geometry.
    const l = (left.slots ?? []).find(
      (entry) =>
        entry.binding === mount.binding && entry.slotId === mount.slotId
    );
    const r = (right.slots ?? []).find(
      (entry) =>
        entry.binding === mount.binding && entry.slotId === mount.slotId
    );
    if (!l?.rect || !r?.rect) {
      problems.push(
        `slot "${mount.slotId}" missing geometry for cross-arm comparison`
      );
      continue;
    } else if (!boxesMatch(l.rect, r.rect)) {
      problems.push(`slot "${mount.slotId}" boxes differ between arms`);
    }
    if (!l?.img?.box || !r?.img?.box) {
      problems.push(
        `slot "${mount.slotId}" missing image geometry for cross-arm comparison`
      );
    } else if (!boxesMatch(l.img.box, r.img.box)) {
      problems.push(`slot "${mount.slotId}" image boxes differ between arms`);
    }
    // Crop-mode equality per mount: identical boxes can still paint
    // different crops when one arm's image uses another object-fit (a
    // contain pilot logo against a cover control, for example). The
    // single-arm check pins only the primary selected image to the
    // surface fit; every other mount compares against its own control
    // rendering, since merchant CSS sets fit per slot, not per surface.
    // Absent images stay silent here: the geometry problems above own
    // that verdict.
    const leftFit = l?.img?.objectFit;
    const rightFit = r?.img?.objectFit;
    if (
      typeof leftFit === 'string' &&
      typeof rightFit === 'string' &&
      leftFit !== rightFit
    ) {
      problems.push(
        `slot "${mount.slotId}" object-fit differs between arms (control ${leftFit}, pilot ${rightFit})`
      );
    }
  }
  return problems;
}
