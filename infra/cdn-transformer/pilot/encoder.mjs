import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { BUDGETS, QUALITY_LADDER, TIERS } from './constants.mjs';
import {
  PilotEncodeError,
  enqueuePilotOp,
  runWorkerOp,
} from './worker-pool.mjs';

export { PilotEncodeError, enqueuePilotOp, runWorkerOp };

export async function probeImageFile(path, options = {}) {
  const result = await runWorkerOp({ input: path, op: 'metadata' }, options);
  return result.metadata;
}

export async function verifyVariant({
  deadlineMs,
  expectedFormat,
  expectedHeight,
  expectedWidth,
  path,
  signal,
}) {
  const facts = await runWorkerOp(
    { expectedFormat, input: path, op: 'verify' },
    { deadlineMs, signal }
  );
  if (facts.width !== expectedWidth || Math.abs(facts.height - expectedHeight) > 1) {
    throw new PilotEncodeError(
      'verify-failed',
      `decoded ${facts.width}x${facts.height}, expected ${expectedWidth}x${expectedHeight}`
    );
  }
  return { ...facts, path };
}

export async function encodeVariant({
  budgetBytes,
  deadlineMs,
  expectedSha256,
  fileStem,
  format,
  quality,
  signal,
  snapshotPath,
  stagingBudget,
  stagingDir,
  width,
}) {
  const output = join(stagingDir, `${fileStem}-w${width}-q${quality}.${format}`);
  // Reserve against the tier ceiling BEFORE the worker writes: charging
  // after the fact lets a large attempt exceed the staging cap on disk
  // (cleanup only runs later, at job scope). Refusing upfront returns the
  // same over-budget outcome the post-write check would reach.
  if (
    stagingBudget &&
    stagingBudget.used + budgetBytes > stagingBudget.cap
  ) {
    return { bytes: budgetBytes, quality, status: 'over-budget' };
  }
  const encoded = await runWorkerOp(
    {
      expectedInputSha256: expectedSha256,
      format,
      input: snapshotPath,
      op: 'encode',
      output,
      quality,
      width,
    },
    { deadlineMs, signal }
  );
  // Remove and reject BEFORE charging: the worker can produce far more
  // than the reserved ceiling, and charging actuals first would throw
  // past the cap (leaving the oversized file on disk) or — worse —
  // permanently charge bytes for a file this branch then unlinks. After
  // the reorder, charge() only ever sees in-budget actuals the reserve
  // check already proved to fit, so it cannot throw here.
  if (encoded.bytes > budgetBytes) {
    await unlink(output).catch(() => {
      // Best-effort removal; job-scope cleanup handles leftovers.
    });
    return { bytes: encoded.bytes, quality, status: 'over-budget' };
  }
  stagingBudget?.charge(encoded.bytes);
  const facts = await verifyVariant({
    deadlineMs,
    expectedFormat: format,
    expectedHeight: encoded.height,
    expectedWidth: encoded.width,
    path: output,
    signal,
  });
  if (facts.sha256 !== encoded.sha256 || facts.bytes !== encoded.bytes) {
    throw new PilotEncodeError(
      'verify-failed',
      'output changed between encode and verification'
    );
  }
  return {
    output: { ...facts, path: output },
    quality,
    status: 'ok',
  };
}

function tierBudget(budgets, role, tierWidth, format) {
  return budgets?.[role]?.[tierWidth]?.[format] ?? BUDGETS[role][tierWidth][format];
}

const CONTENT_TYPE_FOR_FORMAT = { avif: 'image/avif', webp: 'image/webp' };

export async function encodeRoleLadder({
  budgets,
  deadlineMs,
  expectedSha256,
  role,
  signal,
  snapshotPath,
  stagingBudget,
  stagingDir,
}) {
  const tiers = TIERS[role];
  if (!tiers) {
    throw new PilotEncodeError('bad-request', `unknown role "${role}"`);
  }
  const source = await probeImageFile(snapshotPath, { deadlineMs, signal });
  const actualWidths = [
    ...new Set(tiers.map((tier) => Math.min(tier, source.orientedWidth))),
  ].sort((left, right) => left - right);
  const encodedByWidth = new Map();
  for (const actualWidth of actualWidths) {
    for (const format of ['avif', 'webp']) {
      const key = `${actualWidth}:${format}`;
      const ceiling = Math.min(
        ...tiers
          .filter((tier) => Math.min(tier, source.orientedWidth) === actualWidth)
          .map((tier) => tierBudget(budgets, role, tier, format))
      );
      let accepted = null;
      let floorBytes = 0;
      for (const quality of QUALITY_LADDER) {
        const attempt = await encodeVariant({
          budgetBytes: ceiling,
          deadlineMs,
          expectedSha256,
          fileStem: `tier-${actualWidth}-${format}`,
          format,
          quality,
          signal,
          snapshotPath,
          stagingBudget,
          stagingDir,
          width: actualWidth,
        });
        if (attempt.status === 'ok') {
          accepted = attempt;
          break;
        }
        floorBytes = attempt.bytes;
      }
      if (!accepted) {
        throw new PilotEncodeError(
          'budget-floor-exceeded',
          `${role} ${actualWidth}px ${format} needs ${floorBytes} bytes at quality floor 55 (ceiling ${ceiling})`
        );
      }
      encodedByWidth.set(key, accepted);
    }
  }
  const results = [];
  for (const requestedWidth of tiers) {
    const actualWidth = Math.min(requestedWidth, source.orientedWidth);
    for (const format of ['avif', 'webp']) {
      const accepted = encodedByWidth.get(`${actualWidth}:${format}`);
      results.push({
        actualWidth,
        bytes: accepted.output.bytes,
        contentType: CONTENT_TYPE_FOR_FORMAT[format],
        format,
        height: accepted.output.height,
        path: accepted.output.path,
        quality: accepted.quality,
        requestedWidth,
        sha256: accepted.output.sha256,
        width: accepted.output.width,
      });
    }
  }
  return { source, tiers: results };
}
