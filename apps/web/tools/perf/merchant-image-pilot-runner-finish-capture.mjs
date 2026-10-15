// Same-navigation screenshot binding for the bound-evidence runner:
// capturedAt is the file's OS-recorded mtime, not finish time, the
// capture must fall inside the measured navigation's window, and the
// pixels must match the session-attested viewport/dpr pair. Split from
// merchant-image-pilot-runner-finish.mjs under the repo line ceiling.
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { MAX_SCREENSHOT_BYTES } from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import { readUpToBytes } from './merchant-image-pilot-preflight-shared.mjs';
import { assertPngDecodes } from './merchant-image-pilot-settings-har.mjs';
import { pngDimensions } from './merchant-image-pilot-settings-png.mjs';

// Screenshot validation reuses the settings gate's own checks: full
// chunk/CRC structure plus a pixel decode, not just the 24-byte
// header. A capture with valid signature/IHDR but truncated or
// corrupt image data would otherwise hash and publish here, then
// fail the gate — reject it before publication instead. Gate errors
// gain the screenshot path for the operator.
async function validatedDimensions(bytes, screenshot) {
  try {
    const dimensions = pngDimensions(bytes);
    await assertPngDecodes(bytes, dimensions);
    return dimensions;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Legacy operator-facing text for the non-PNG case (pinned by
    // the finish-version suite); newer structural/decode failures
    // carry the gate's own message.
    if (message === 'not a PNG') {
      throw new Error(`screenshot is not a PNG file: ${screenshot}`);
    }
    throw new Error(`screenshot rejected (${message}): ${screenshot}`);
  }
}

export async function bindScreenshotCapture({
  clockSkewMs,
  deviceScaleFactor,
  height,
  nowMs,
  provenanceWindowMs,
  runId,
  screenshot,
  startedMs,
  tool,
  width,
}) {
  // A stale file from another run (or a future-dated one) refuses here
  // instead of gaining this run's id. The bounds mirror the gate's
  // capturedAt checks exactly.
  const shotStat = await stat(screenshot);
  const shotMtimeMs = shotStat.mtimeMs;
  if (shotMtimeMs > nowMs + clockSkewMs) {
    throw new Error(
      `screenshot is newer than the finish clock (clock skew): ${screenshot}`
    );
  }
  if (shotMtimeMs < startedMs) {
    throw new Error(
      `screenshot predates the measured navigation; capture after navigating instead of binding a stale file: ${screenshot}`
    );
  }
  if (shotMtimeMs - startedMs > provenanceWindowMs) {
    throw new Error(
      `screenshot is stale (>1h after the measured navigation); re-capture instead of binding old evidence: ${screenshot}`
    );
  }
  const shotRead = await readUpToBytes(screenshot, MAX_SCREENSHOT_BYTES);
  if (shotRead.truncated) {
    throw new Error(
      `screenshot exceeds ${MAX_SCREENSHOT_BYTES} bytes: ${screenshot}`
    );
  }
  // The session record attests the pair; the capture's actual pixels
  // must agree, or a wrong-size file gains a geometry the gate would
  // trust from the record alone.
  const expectedWidth = Math.round(width * deviceScaleFactor);
  const expectedHeight = Math.round(height * deviceScaleFactor);
  const actual = await validatedDimensions(shotRead.bytes, screenshot);
  if (actual.width !== expectedWidth || actual.height !== expectedHeight) {
    throw new Error(
      `screenshot is ${actual.width}x${actual.height} but viewport ${width}x${height} at dpr ${deviceScaleFactor} requires ${expectedWidth}x${expectedHeight}: ${screenshot}`
    );
  }
  return {
    capturedAt: new Date(shotMtimeMs).toISOString(),
    deviceScaleFactor,
    event: 'screenshot-capture',
    runId,
    screenshotSha256: createHash('sha256').update(shotRead.bytes).digest('hex'),
    tool,
    viewport: { height, width },
  };
}
