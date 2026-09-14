import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function filesUnder(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = join(path, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

export function validateArtifacts(path) {
  const files = filesUnder(path);
  const has = (pattern) => files.some((file) => pattern.test(file));
  const hasVideo = files.some((file) => {
    if (!/\.(?:mp4|webm)$/i.test(file)) return false;
    try {
      return statSync(file).size > 0;
    } catch {
      return false;
    }
  });
  let browser;
  let failedResource = false;
  let visualMetricsInHar = false;
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
      if (log?.browser) browser = log.browser;
      if (!Array.isArray(pages)) continue;
      validMetrics = pages.some((page) => {
        const metrics = page._visualMetrics;
        return (
          metrics &&
          Number.isFinite(metrics.FirstVisualChange) &&
          Number.isFinite(metrics.LastVisualChange)
        );
      });
    } catch {
      // Ignore malformed individual HARs; other samples must still be scanned.
    }
    visualMetricsInHar ||= validMetrics;
  }
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
