// Runner-provenance validators for the pilot effective-settings gate.
// Extracted from settings-helpers.mjs so each module stays under the
// repository's 300-line ceiling. No I/O, no subprocesses.
import { createHash } from 'node:crypto';

// Runner-produced cache-reset provenance artifact. The gate accepts a
// PATH to this JSON — never a bare caller string, which would let any
// warm run certify itself cold:
//   {"event":"profile-reset","freshProfile":true,
//    "profileDir":"<runner profile path>","resetAt":"<ISO datetime>",
//    "runId":"<single-use navigation id>","tool":"<runner name>"}
// A single reset certifies only one HAR navigation and must precede it by at most one
// hour: a stale (or post-run) reset proves nothing about this run. The
// runId binds the artifact to its navigation: timestamps alone cannot,
// because separate single-page HARs (control/pilot iterations on one
// reused profile) would each pass the window check against one shared
// reset. The runner mints one runId per reset+navigation pair and records
// it in both the artifact and the HAR page's _meta.
export function verifyCacheProvenance(text, pages, sourceLabel) {
  if (text === null || text === undefined) {
    return {
      error: `cannot read cache-provenance artifact ${sourceLabel}`,
      ok: false,
    };
  }
  let artifact;
  try {
    artifact = JSON.parse(String(text));
  } catch {
    return { error: 'cache-provenance artifact is not valid JSON', ok: false };
  }
  if (
    !artifact ||
    typeof artifact !== 'object' ||
    artifact.event !== 'profile-reset' ||
    artifact.freshProfile !== true ||
    typeof artifact.profileDir !== 'string' ||
    artifact.profileDir.length === 0 ||
    typeof artifact.tool !== 'string' ||
    artifact.tool.length === 0 ||
    typeof artifact.runId !== 'string' ||
    artifact.runId.length === 0 ||
    artifact.runId.length > 128 ||
    typeof artifact.resetAt !== 'string' ||
    !Number.isFinite(Date.parse(artifact.resetAt))
  ) {
    return {
      error:
        'cache-provenance artifact must be a runner profile-reset record {event, freshProfile, profileDir, resetAt, runId, tool}',
      ok: false,
    };
  }
  if (pages?.length > 1) {
    return {
      error: 'one cache reset can certify exactly one HAR iteration',
      ok: false,
    };
  }
  const pageRunId = pages?.[0]?._meta?.runId;
  if (typeof pageRunId !== 'string' || pageRunId.length === 0) {
    return {
      error: 'cache-provenance cannot bind: HAR page carries no _meta.runId',
      ok: false,
    };
  }
  if (pageRunId !== artifact.runId) {
    return {
      error:
        'cache-provenance runId does not match the measured navigation: one reset certifies exactly one navigation',
      ok: false,
    };
  }
  const starts = (pages ?? [])
    .map((page) => Date.parse(page?.startedDateTime))
    .filter(Number.isFinite);
  if (starts.length === 0) {
    return {
      error: 'cache-provenance cannot bind: HAR pages carry no startedDateTime',
      ok: false,
    };
  }
  const earliest = Math.min(...starts);
  const resetAt = Date.parse(artifact.resetAt);
  if (resetAt > earliest) {
    return {
      error: 'cache-provenance reset postdates the measured run',
      ok: false,
    };
  }
  if (earliest - resetAt > 3_600_000) {
    return {
      error: 'cache-provenance reset is stale (>1h before the measured run)',
      ok: false,
    };
  }
  return { ok: true, summary: `${artifact.tool}@${artifact.resetAt}` };
}

// Screenshot/HAR navigation binding: the geometry gate compares PNG
// dimensions against the HAR's expected viewport/DPR, so without a
// same-navigation binding a stale screenshot from another iteration
// (e.g. DPR-2) can certify the wrong HAR (e.g. DPR-1). The runner
// artifact binds the exact screenshot bytes (sha256) to the HAR page's
// single-use _meta.runId within the capture window.
export function verifyScreenshotProvenance(
  text,
  pages,
  screenshotBytes,
  sourceLabel
) {
  if (text === null || text === undefined) {
    return {
      error: `cannot read screenshot-provenance artifact ${sourceLabel}`,
      ok: false,
    };
  }
  let artifact;
  try {
    artifact = JSON.parse(String(text));
  } catch {
    return {
      error: 'screenshot-provenance artifact is not valid JSON',
      ok: false,
    };
  }
  if (
    !artifact ||
    typeof artifact !== 'object' ||
    artifact.event !== 'screenshot-capture' ||
    typeof artifact.tool !== 'string' ||
    artifact.tool.length === 0 ||
    typeof artifact.runId !== 'string' ||
    artifact.runId.length === 0 ||
    artifact.runId.length > 128 ||
    typeof artifact.screenshotSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(artifact.screenshotSha256) ||
    typeof artifact.capturedAt !== 'string' ||
    !Number.isFinite(Date.parse(artifact.capturedAt))
  ) {
    return {
      error:
        'screenshot-provenance artifact must be a runner screenshot-capture record {event, tool, runId, screenshotSha256, capturedAt}',
      ok: false,
    };
  }
  if (pages?.length > 1) {
    return {
      error: 'one screenshot can certify exactly one HAR iteration',
      ok: false,
    };
  }
  const pageRunId = pages?.[0]?._meta?.runId;
  if (typeof pageRunId !== 'string' || pageRunId.length === 0) {
    return {
      error:
        'screenshot-provenance cannot bind: HAR page carries no _meta.runId',
      ok: false,
    };
  }
  if (pageRunId !== artifact.runId) {
    return {
      error:
        'screenshot-provenance runId does not match the measured navigation: one screenshot certifies exactly one navigation',
      ok: false,
    };
  }
  const actual = createHash('sha256').update(screenshotBytes).digest('hex');
  if (actual !== artifact.screenshotSha256) {
    return {
      error:
        'screenshot-provenance sha256 does not match the supplied screenshot bytes',
      ok: false,
    };
  }
  const starts = (pages ?? [])
    .map((page) => Date.parse(page?.startedDateTime))
    .filter(Number.isFinite);
  if (starts.length === 0) {
    return {
      error:
        'screenshot-provenance cannot bind: HAR pages carry no startedDateTime',
      ok: false,
    };
  }
  const earliest = Math.min(...starts);
  const capturedAt = Date.parse(artifact.capturedAt);
  if (capturedAt < earliest) {
    return {
      error: 'screenshot-provenance capture predates the measured navigation',
      ok: false,
    };
  }
  if (capturedAt - earliest > 3_600_000) {
    return {
      error:
        'screenshot-provenance capture is stale (>1h after the measured run)',
      ok: false,
    };
  }
  return { ok: true, summary: `${artifact.tool}@${artifact.capturedAt}` };
}
