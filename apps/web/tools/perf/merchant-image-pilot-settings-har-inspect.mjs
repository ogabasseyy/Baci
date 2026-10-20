// HAR inspection for the pilot effective-settings gate: extracts the
// recorded request User-Agent, cache-hit entries, iteration count verdict,
// and connectivity verdict from a parsed Browsertime/Sitespeed HAR.
function extractHarUserAgent(har) {
  const headers = har?.log?.entries?.[0]?.request?.headers ?? [];
  const found = headers.find(
    (header) => String(header.name).toLowerCase() === 'user-agent'
  );
  return found ? String(found.value) : null;
}

function extractCacheHits(har) {
  return (har?.log?.entries ?? []).filter((entry) => {
    const response = entry?.response ?? {};
    return (
      response.status === 304 ||
      response.fromDiskCache === true ||
      response.fromPrefetchCache === true ||
      response.fromServiceWorker === true ||
      entry?.cache?.beforeRequest !== undefined
    );
  });
}

export function inspectHarRecording(
  har,
  { expectConnectivity, expectIterations } = {}
) {
  const pages = har?.log?.pages ?? [];
  const iterationsCheck =
    pages.length === expectIterations
      ? { ok: true }
      : {
          error: `recorded ${pages.length} runs, expected ${expectIterations}`,
          ok: false,
        };
  const badConnectivity = pages.filter(
    (page) => page?._meta?.connectivity !== expectConnectivity
  );
  const connectivityCheck =
    badConnectivity.length === 0
      ? { ok: true }
      : {
          error: `recorded ${pages.map((page) => page?._meta?.connectivity).join(',')}, expected ${expectConnectivity}`,
          ok: false,
        };
  return {
    cacheHits: extractCacheHits(har),
    connectivityCheck,
    iterationsCheck,
    userAgent: extractHarUserAgent(har),
  };
}
