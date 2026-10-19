// Navigation-route binding for the pilot effective-settings gate:
// verifies that every recorded HAR page or Lighthouse report URL
// matches the expected navigation route after URL normalization.
export function verifyRecordedRoute(target, expectRoute, mode = 'har') {
  let expected;
  try {
    expected = new URL(expectRoute).href;
  } catch {
    return { error: `bad --expect-route: ${expectRoute}`, ok: false };
  }
  if (mode === 'lighthouse') {
    for (const field of ['requestedUrl', 'finalDisplayedUrl']) {
      const value = target?.[field];
      if (!value) {
        return {
          error: `Lighthouse report has no ${field} to bind to the route`,
          ok: false,
        };
      }
      let actual;
      try {
        actual = new URL(value).href;
      } catch {
        return {
          error: `Lighthouse ${field} is not a valid URL: ${value}`,
          ok: false,
        };
      }
      if (actual !== expected) {
        return {
          error: `Lighthouse ${field} is ${actual}, expected ${expected}`,
          ok: false,
        };
      }
    }
    return { ok: true };
  }
  if (!Array.isArray(target) || target.length === 0) {
    return { error: 'HAR has no pages to bind to the route', ok: false };
  }
  for (const page of target) {
    const finalUrl = page?._url || page?.title;
    if (!finalUrl) {
      return {
        error: 'HAR page carries no navigation URL (_url or title)',
        ok: false,
      };
    }
    let actual;
    try {
      actual = new URL(finalUrl).href;
    } catch {
      return {
        error: `HAR page navigation is not a valid URL: ${finalUrl}`,
        ok: false,
      };
    }
    if (actual !== expected) {
      return {
        error: `HAR page navigated ${actual}, expected ${expected}`,
        ok: false,
      };
    }
  }
  return { ok: true };
}
