export function getFirstDebugBearQuickTest(body) {
  if (!body || typeof body !== 'object') return null;
  if (Array.isArray(body)) return body[0] ?? null;
  if (Array.isArray(body.quickTests)) return body.quickTests[0] ?? null;
  if (Array.isArray(body.tests)) return body.tests[0] ?? null;
  return body;
}

export function getDebugBearQuickTestId(body) {
  const quickTest = getFirstDebugBearQuickTest(body);
  return (
    quickTest?.id ??
    quickTest?.quickTestId ??
    quickTest?.testId ??
    quickTest?.resultId ??
    null
  );
}

export function getDebugBearQuickTestPollPath({
  body,
  projectId,
  quickTestId,
}) {
  const quickTest = getFirstDebugBearQuickTest(body);
  const link =
    quickTest?.apiUrl ||
    quickTest?.pollUrl ||
    quickTest?.resultApiUrl ||
    quickTest?._links?.self?.href ||
    quickTest?._links?.result?.href;

  if (typeof link === 'string') {
    try {
      const url = new URL(link, 'https://www.debugbear.com');
      if (
        url.hostname === 'www.debugbear.com' ||
        url.hostname === 'debugbear.com'
      ) {
        return url.pathname.replace(/^\/api\/v1/, '');
      }
    } catch {
      // Fall through to the documented project-scoped endpoint shape.
    }
  }

  if (!quickTestId) {
    throw new Error('Missing DebugBear quick test id');
  }

  if (projectId) {
    return `/project/${encodeURIComponent(projectId)}/quickTest/${encodeURIComponent(
      quickTestId
    )}`;
  }

  return `/quickTest/${encodeURIComponent(quickTestId)}`;
}

export function getDebugBearMetric(body, names) {
  if (!Array.isArray(names)) {
    throw new TypeError('names must be an array of metric names');
  }
  if (!body || typeof body !== 'object') return null;

  for (const name of names) {
    const values = [
      body.metrics?.[name],
      body.summary?.[name],
      body.lighthouseResult?.audits?.[name]?.numericValue,
    ];

    for (const value of values) {
      if (typeof value === 'number') return value;
    }
  }

  return null;
}

function normalizeScore(value) {
  if (typeof value !== 'number') return null;
  return Math.round(value <= 1 ? value * 100 : value);
}

export function getDebugBearCategoryScore(body, names) {
  if (!Array.isArray(names)) {
    throw new TypeError('names must be an array of category names');
  }
  if (!body || typeof body !== 'object') return null;

  for (const name of names) {
    const score =
      normalizeScore(body.categories?.[name]?.score) ??
      normalizeScore(body.metrics?.[`${name}.score`]) ??
      normalizeScore(body.summary?.[`${name}.score`]) ??
      normalizeScore(body.lighthouseResult?.categories?.[name]?.score) ??
      normalizeScore(body[name]?.score);

    if (score !== null) return score;
  }

  return null;
}
