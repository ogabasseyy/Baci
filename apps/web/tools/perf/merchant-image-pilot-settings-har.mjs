// HAR checks for the pilot effective-settings gate.
//
// Extracted from settings.mjs so each module stays under the
// repository's 300-line ceiling: recorded HAR settings, screenshot
// geometry + navigation binding, cold-cache evidence, and the
// attested browser executable.
import { readFile } from 'node:fs/promises';
import {
  findCacheHits,
  harUserAgent,
  parseDimensions,
  parsePositiveInteger,
  parsePositiveNumber,
  pngDimensions,
  verifyBrowserVersion,
  verifyHarConnectivity,
  verifyHarIterations,
} from './merchant-image-pilot-settings-helpers.mjs';
import {
  verifyCacheProvenance,
  verifyScreenshotProvenance,
} from './merchant-image-pilot-settings-provenance.mjs';

export async function checkHar(args, pass, fail, warn, recorded) {
  let har;
  try {
    har = JSON.parse(await readFile(args.har, 'utf8'));
  } catch {
    fail('har.readable', `cannot parse ${args.har}`);
    return;
  }
  const pages = har?.log?.pages ?? [];
  const iterations = parsePositiveInteger(
    args['expect-iterations'],
    'expect-iterations'
  );
  const iterationsCheck = verifyHarIterations(pages, iterations);
  if (!iterationsCheck.ok) {
    fail('har.iterations', iterationsCheck.error);
  } else {
    pass('har.iterations');
  }
  const connectivityCheck = verifyHarConnectivity(
    pages,
    args['expect-connectivity']
  );
  if (!connectivityCheck.ok) {
    fail('har.connectivity', connectivityCheck.error);
  } else {
    pass('har.connectivity');
  }
  const ua = harUserAgent(har);
  recorded.browser = ua;
  // The request User-Agent is emulated configuration, not independent proof
  // of the browser executable version. The optional --browser-version
  // attestation (runner/CDP metadata) is recorded separately below.
  if (!ua?.includes(`Chrome/${args['expect-chrome-major']}.`)) {
    fail(
      'har.browser',
      `recorded UA does not show Chrome ${args['expect-chrome-major']} (emulated UA, not executable proof)`
    );
  } else {
    pass('har.browser');
  }
  const viewport = parseDimensions(args['expect-viewport'], 'expect-viewport');
  const dpr = parsePositiveNumber(args['expect-dpr'], 'expect-dpr');
  try {
    const screenshotBytes = await readFile(args.screenshot);
    const png = pngDimensions(screenshotBytes);
    recorded.screenshot = `${png.width}x${png.height}`;
    const geometryProblems = [];
    // ±2px absorbs DPR rounding (667@3 → 2000); a wrong DPR or viewport
    // still misses by hundreds.
    if (
      Math.abs(png.width - viewport.width * dpr) > 2 ||
      Math.abs(png.height - viewport.height * dpr) > 2
    ) {
      geometryProblems.push(
        `screenshot ${png.width}x${png.height} is not ${viewport.width}x${viewport.height}@${dpr}`
      );
    }
    // Same-navigation binding (REQUIRED): dimensions alone cannot prove
    // the PNG came from the measured HAR page — a stale DPR-2
    // screenshot would otherwise certify a DPR-1 HAR. The runner
    // artifact binds the exact screenshot bytes to the page's runId.
    const shotProvenancePath = args['screenshot-provenance'];
    if (shotProvenancePath === undefined) {
      geometryProblems.push(
        'no screenshot provenance: an unbound PNG cannot certify the HAR navigation (pass --screenshot-provenance=<runner-capture-artifact.json>)'
      );
    } else {
      const text = await readFile(shotProvenancePath, 'utf8').catch(() => null);
      const shot = verifyScreenshotProvenance(
        text,
        pages,
        screenshotBytes,
        shotProvenancePath
      );
      if (!shot.ok) {
        geometryProblems.push(shot.error);
      } else {
        recorded.screenshotProvenance = shot.summary;
      }
    }
    if (geometryProblems.length > 0) {
      fail('har.geometry', geometryProblems.join('; '));
    } else {
      pass('har.geometry');
    }
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    fail('har.geometry', `cannot use ${args.screenshot} (${why})`);
  }
  // Absence of recorded hits is necessary but NOT sufficient: converters
  // such as chrome-har drop disk-cached resources by default, so a warm run
  // can present zero entries. The cold claim additionally requires a
  // validated runner artifact (--cache-provenance): a bare caller string
  // would let any warm run certify itself cold.
  const cacheHits = findCacheHits(har);
  const provenancePath = args['cache-provenance'];
  let provenanceError = null;
  if (provenancePath !== undefined) {
    const text = await readFile(provenancePath, 'utf8').catch(() => null);
    const provenance = verifyCacheProvenance(text, pages, provenancePath);
    if (!provenance.ok) {
      provenanceError = provenance.error;
    } else {
      recorded.cacheProvenance = provenance.summary;
    }
  }
  if (cacheHits.length > 0) {
    fail(
      'har.cold-cache',
      `${cacheHits.length} recorded cache hits (304/disk/prefetch/service-worker/beforeRequest)`
    );
  } else if (provenanceError) {
    fail('har.cold-cache', provenanceError);
  } else if (args['cache-provenance'] === undefined) {
    fail(
      'har.cold-cache',
      'no recorded hits, but no cache-reset provenance: absence cannot prove cold (converters may omit cached resources)'
    );
  } else {
    pass('har.cold-cache');
  }
  if (args['cache-provenance'] === undefined) {
    warn(
      'har.cache-provenance',
      'unknown (no runner profile/reset provenance supplied)'
    );
  } else if (provenanceError) {
    fail('har.cache-provenance', provenanceError);
  } else {
    pass('har.cache-provenance');
  }
  if (args['browser-version'] === undefined) {
    warn(
      'har.browser-version',
      'unknown (no runner/CDP executable version supplied; UA above is emulated)'
    );
  } else {
    const version = args['browser-version'];
    recorded.browserExecutable = version;
    const checked = verifyBrowserVersion(version, args['expect-chrome-major']);
    if (!checked.ok) {
      fail('har.browser-version', checked.error);
    } else {
      pass('har.browser-version');
    }
  }
}
