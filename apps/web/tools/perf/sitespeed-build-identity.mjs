const DEFAULT_TIMEOUT_MS = 5_000;

function readBuildIds(html) {
  // Pages Router emits __NEXT_DATA__; parse only that script's JSON.
  const ids = new Set();
  const nextData = html.match(
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (nextData) {
    try {
      const payload = JSON.parse(nextData[1]);
      if (typeof payload?.buildId === 'string') ids.add(payload.buildId);
    } catch {
      // Continue to the App Router marker; malformed data fails closed below.
    }
  }

  // App Router flight bootstrap records are JavaScript string literals. Decode
  // the quoted argument with JSON.parse, then parse only numbered flight JSON
  // records. Never scan arbitrary HTML or evaluate script content.
  const flightPush = /self\.__next_f\.push\(\[1,\s*("(?:\\.|[^"\\])*")\]\)/g;
  for (const match of html.matchAll(flightPush)) {
    let record;
    try {
      record = JSON.parse(match[1]);
    } catch {
      continue;
    }
    for (const line of record.split('\n')) {
      const root = line.match(/^\d+:(\{[\s\S]*\})$/);
      if (!root) continue;
      try {
        const payload = JSON.parse(root[1]);
        if (typeof payload?.b === 'string') ids.add(payload.b);
      } catch {
        // Non-JSON flight records carry no build id; skip the line.
      }
    }
  }
  return [...ids];
}

export async function assertServedBuild(
  baseUrl,
  expectedBuildId,
  { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}
) {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    throw new Error('served build URL is required');
  }
  if (typeof expectedBuildId !== 'string' || !expectedBuildId.trim()) {
    throw new Error('expected served build ID is required');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('served build timeout must be positive');
  }

  const url = new URL('/', baseUrl).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'text/html' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `served build preflight returned HTTP ${response.status}`
      );
    }

    const buildIds = readBuildIds(await response.text());
    if (!buildIds.length) {
      throw new Error('served HTML does not contain a Next.js build ID');
    }
    if (buildIds.length > 1) {
      throw new Error('served HTML contains conflicting Next.js build IDs');
    }
    if (buildIds[0] !== expectedBuildId) {
      throw new Error(
        `served Next.js build ID mismatch: expected ${expectedBuildId}, received ${buildIds[0]}`
      );
    }

    return {
      buildId: expectedBuildId,
      status: response.status,
      url: response.url || url,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`served build preflight timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
