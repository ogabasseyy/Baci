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

// Pure verdict on the collected selected-image state: the element must have
// decoded (complete + nonzero natural width) from a staged URL of the
// expected arm. A network failure or an HTML error page leaves the element
// in place, so geometry alone cannot prove the image loaded.
export function selectedImageProblems(image, arm) {
  if (!image) {
    return ['selected image absent'];
  }
  if (!image.complete || (image.naturalWidth ?? 0) < 1) {
    return ['selected image did not decode'];
  }
  if (!image.currentSrc) {
    return ['selected image has no source'];
  }
  if (arm === 'pilot') {
    if (
      image.currentSrc.includes('/originals/') ||
      !image.currentSrc.includes('/__pilot/')
    ) {
      return ['pilot selected a non-staged image URL'];
    }
  } else if (!image.currentSrc.includes('/originals/')) {
    return ['control selected no staged original'];
  }
  return [];
}
