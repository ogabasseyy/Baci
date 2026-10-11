// HAR checks for the pilot effective-settings gate.
//
// Extracted from settings.mjs so each module stays under the
// repository's 300-line ceiling: recorded HAR settings, screenshot
// geometry + navigation binding, cold-cache evidence, and the
// attested browser executable.
import sharp from 'sharp';
import {
  MAX_HAR_BYTES,
  MAX_INVENTORY_BYTES,
  MAX_SCREENSHOT_BYTES,
  SHARP_LIMITS,
} from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import { readUpToBytes } from './merchant-image-pilot-preflight-shared.mjs';
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
  verifyHarRoute,
} from './merchant-image-pilot-settings-helpers.mjs';

// IDAT presence is not evidence: a structurally valid PNG with garbage
// compressed pixels (valid CRCs, positive IHDR) would otherwise satisfy
// geometry and hash provenance with no reviewable visual artifact. A
// full pixel decode with scanline dimensions matching the IHDR proves
// the screenshot is viewable at the attested size, under the same
// generator decode limits.
async function assertPngDecodes(bytes, dimensions) {
  let info;
  try {
    ({ info } = await sharp(bytes, { ...SHARP_LIMITS })
      .raw()
      .toBuffer({ resolveWithObject: true }));
  } catch {
    throw new Error('screenshot pixels do not decode');
  }
  if (info.width !== dimensions.width || info.height !== dimensions.height) {
    throw new Error('screenshot decoded dimensions differ from its IHDR');
  }
}

// Bounded operator-artifact read: an unconsumed multi-gigabyte file must
// fail the gate by size, never exhaust the collector before parsing.
async function readBoundedText(path, maxBytes) {
  try {
    const read = await readUpToBytes(path, maxBytes);
    return {
      text: read.truncated ? null : read.bytes.toString('utf8'),
      truncated: read.truncated,
    };
  } catch {
    return { text: null, truncated: false };
  }
}

import {
  verifyCacheProvenance,
  verifyScreenshotProvenance,
} from './merchant-image-pilot-settings-provenance.mjs';

export async function checkHar(args, pass, fail, warn, recorded) {
  let har;
  try {
    const bounded = await readUpToBytes(args.har, MAX_HAR_BYTES);
    if (bounded.truncated) {
      fail('har.readable', `${args.har} exceeds the HAR byte budget`);
      return;
    }
    har = JSON.parse(bounded.bytes.toString('utf8'));
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
  const routeCheck = verifyHarRoute(pages, args['expect-route']);
  if (!routeCheck.ok) {
    fail('har.route', routeCheck.error);
  } else {
    pass('har.route');
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
    // The geometry check must read the artifact, but a corrupted or
    // replaced multi-gigabyte file fails by size instead of exhausting
    // the settings process before validation.
    const boundedShot = await readUpToBytes(
      args.screenshot,
      MAX_SCREENSHOT_BYTES
    );
    if (boundedShot.truncated) {
      throw new Error('screenshot exceeds the screenshot byte budget');
    }
    const screenshotBytes = boundedShot.bytes;
    const png = pngDimensions(screenshotBytes);
    await assertPngDecodes(screenshotBytes, png);
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
      // Provenance artifacts are small runner JSON records: the
      // operator-JSON ceiling bounds them like every other operator
      // JSON input, instead of buffering an unbounded file.
      const bounded = await readBoundedText(
        shotProvenancePath,
        MAX_INVENTORY_BYTES
      );
      const shot = bounded.truncated
        ? {
            error:
              'screenshot provenance artifact exceeds the operator-JSON budget',
            ok: false,
          }
        : verifyScreenshotProvenance(
            bounded.text,
            pages,
            screenshotBytes,
            shotProvenancePath
          );
      if (!shot.ok) {
        geometryProblems.push(shot.error);
      } else {
        recorded.screenshotProvenance = shot.summary;
        // Independent pair check: the PNG product above cannot tell
        // 750x1334@1 from 375x667@2, so the runner-recorded CSS
        // viewport and deviceScaleFactor each match exactly — no
        // tolerance, since recorded configuration has no rounding.
        if (
          shot.viewport.width !== viewport.width ||
          shot.viewport.height !== viewport.height
        ) {
          geometryProblems.push(
            `provenance viewport ${shot.viewport.width}x${shot.viewport.height} is not expected ${viewport.width}x${viewport.height}`
          );
        }
        if (shot.deviceScaleFactor !== dpr) {
          geometryProblems.push(
            `provenance deviceScaleFactor ${shot.deviceScaleFactor} is not expected ${dpr}`
          );
        }
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
    const bounded = await readBoundedText(provenancePath, MAX_INVENTORY_BYTES);
    const provenance = bounded.truncated
      ? {
          error: 'cache provenance artifact exceeds the operator-JSON budget',
          ok: false,
        }
      : verifyCacheProvenance(bounded.text, pages, provenancePath);
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
