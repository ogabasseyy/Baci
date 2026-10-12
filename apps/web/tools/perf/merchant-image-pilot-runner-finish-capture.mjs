// Same-navigation screenshot binding for the bound-evidence runner:
// capturedAt is the file's OS-recorded mtime, not finish time, the
// capture must fall inside the measured navigation's window, and the
// pixels must match the session-attested viewport/dpr pair. Split from
// merchant-image-pilot-runner-finish.mjs under the repo line ceiling.
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { MAX_SCREENSHOT_BYTES } from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import { readUpToBytes } from './merchant-image-pilot-preflight-shared.mjs';

// PNG geometry without a decoder dependency: 8-byte signature plus the
// IHDR chunk (length 13, width/height big-endian). A non-PNG file, or a
// capture at the wrong size, refuses here instead of gaining the run's
// id with geometry the gate would trust from the record alone.
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function pngDimensions(bytes, screenshot) {
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.subarray(12, 16).toString('latin1') !== 'IHDR'
  ) {
    throw new Error(`screenshot is not a PNG file: ${screenshot}`);
  }
  return { height: bytes.readUInt32BE(20), width: bytes.readUInt32BE(16) };
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
  const actual = pngDimensions(shotRead.bytes, screenshot);
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
