import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

function filesUnder(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = join(path, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

export function defaultVideoProbe(file) {
  const result = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_type',
      '-of',
      'json',
      file,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000 }
  );
  try {
    const payload = JSON.parse(result.stdout ?? '');
    const duration = Number.parseFloat(payload.format?.duration ?? '');
    const hasVideoStream = payload.streams?.some(
      (stream) => stream.codec_type === 'video'
    );
    return {
      ok:
        result.status === 0 &&
        hasVideoStream === true &&
        Number.isFinite(duration),
      duration,
    };
  } catch {
    return { ok: false, duration: Number.NaN };
  }
}

export function validateArtifacts(
  path,
  { expectedUrl, videoProbe = defaultVideoProbe } = {}
) {
  const files = filesUnder(path);
  const has = (pattern) => files.some((file) => pattern.test(file));
  const hasVideo = files.some((file) => {
    if (!/\.(?:mp4|webm)$/i.test(file)) return false;
    try {
      if (statSync(file).size <= 0) return false;
      const probe = videoProbe(file);
      return (
        probe?.ok === true &&
        Number.isFinite(probe.duration) &&
        probe.duration > 0
      );
    } catch (_error) {
      return false;
    }
  });
  const consoleFiles = files.filter((file) =>
    /console-\d+\.json\.gz$/i.test(file)
  );
  if (!consoleFiles.length) throw new Error('missing console evidence');
  let consoleRecords;
  try {
    const parsed = consoleFiles.map((file) =>
      JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'))
    );
    if (parsed.some((records) => !Array.isArray(records)))
      throw new Error('shape');
    consoleRecords = parsed.flat();
  } catch {
    throw new Error('malformed console evidence');
  }
  if (!Array.isArray(consoleRecords))
    throw new Error('malformed console evidence');
  if (
    consoleRecords.some(
      (record) =>
        !record ||
        typeof record !== 'object' ||
        typeof record.level !== 'string'
    )
  )
    throw new Error('malformed console evidence');
  if (consoleRecords.some((record) => /^(SEVERE|ERROR)$/i.test(record.level)))
    throw new Error('error-level console record captured');
  let browser;
  let failedResource = false;
  let visualMetricsInHar = false;
  let matchedExpectedUrl = expectedUrl === undefined;
  let contractError;
  for (const file of files.filter((candidate) => /\.har$/i.test(candidate))) {
    let validMetrics = false;
    try {
      const log = JSON.parse(readFileSync(file, 'utf8')).log;
      const pages = log?.pages;
      for (const entry of log?.entries ?? []) {
        const kind = entry._resourceType ?? entry.response?._resourceType ?? '';
        const mime = entry.response?.content?.mimeType ?? '';
        const critical =
          /^(document|stylesheet|script|font|image)$/i.test(kind) ||
          /^(image\/|font\/|text\/css|text\/html|application\/(javascript|x-javascript))/i.test(
            mime
          );
        if (
          critical &&
          (!Number.isInteger(entry.response?.status) ||
            entry.response.status < 200 ||
            entry.response.status >= 400)
        )
          failedResource = true;
      }
      if (
        typeof log?.browser?.name !== 'string' ||
        !log.browser.name.trim() ||
        typeof log.browser.version !== 'string' ||
        !log.browser.version.trim()
      )
        throw new Error('missing browser name/version in HAR');
      browser ??= log.browser;
      if (!Array.isArray(pages)) continue;
      for (const page of pages) {
        const finalUrl = page?._url || page?.title;
        if (expectedUrl && finalUrl) {
          matchedExpectedUrl ||=
            new URL(finalUrl).href === new URL(expectedUrl).href;
        }
        if (
          /\b(?:404|not found|application error|internal server error)\b/i.test(
            page?.title ?? ''
          )
        )
          throw new Error('soft-404/application error evidence in HAR');
      }
      validMetrics = pages.some((page) => {
        const finalUrl = page?._url || page?.title;
        if (
          expectedUrl &&
          (!finalUrl || new URL(finalUrl).href !== new URL(expectedUrl).href)
        )
          return false;
        const metrics = page._visualMetrics;
        return (
          metrics &&
          Number.isFinite(metrics.FirstVisualChange) &&
          Number.isFinite(metrics.LastVisualChange) &&
          metrics.FirstVisualChange >= 0 &&
          metrics.LastVisualChange > 0 &&
          metrics.LastVisualChange >= metrics.FirstVisualChange
        );
      });
    } catch (error) {
      if (
        error instanceof Error &&
        /missing browser|soft-404/.test(error.message)
      )
        contractError ??= error;
      // Ignore malformed individual HARs; other samples must still be scanned.
    }
    visualMetricsInHar ||= validMetrics;
  }
  if (!browser && has(/\.har$/i))
    throw new Error('missing browser name/version in HAR');
  if (contractError) throw contractError;
  if (!matchedExpectedUrl)
    throw new Error('served final URL did not match expected URL');
  const result = {
    video: hasVideo,
    har: has(/\.har$/i),
    visualMetrics: visualMetricsInHar,
    ...(browser ? { browser } : {}),
  };
  if (failedResource) throw new Error('failed critical resource in HAR');
  if (!result.video || !result.har || !result.visualMetrics)
    throw new Error(
      `missing sitespeed artifacts (${Object.entries(result)
        .filter(([key, value]) => key !== 'browser' && !value)
        .map(([key]) => key)
        .join(', ')})`
    );
  return result;
}
