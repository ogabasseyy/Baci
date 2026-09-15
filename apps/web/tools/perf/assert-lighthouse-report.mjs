import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Validity only: visual inspection and performance budgets are separate gates. */
export function assertLighthouseReport(report) {
  if (!report || report.runtimeError) throw new Error('invalid navigation');
  for (const id of ['largest-contentful-paint', 'cumulative-layout-shift']) {
    const value = report.audits?.[id]?.numericValue;
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      (id === 'largest-contentful-paint' && value === 0)
    ) {
      throw new Error(`missing or invalid ${id}`);
    }
  }
  const requests = report.audits?.['network-requests']?.details?.items;
  if (!Array.isArray(requests) || requests.length === 0) {
    throw new Error('missing network evidence');
  }
  for (const request of requests) {
    if (
      ![
        'Image',
        'Document',
        'Stylesheet',
        'Script',
        'Font',
        'XHR',
        'Fetch',
      ].includes(request.resourceType)
    )
      continue;
    if (
      !Number.isInteger(request.statusCode) ||
      request.statusCode < 200 ||
      request.statusCode >= 400
    ) {
      throw new Error(`failed ${request.resourceType} request`);
    }
  }
  const frames = report.audits?.['screenshot-thumbnails']?.details?.items;
  if (
    !Array.isArray(frames) ||
    frames.length === 0 ||
    frames.some((frame) => !frame.data)
  ) {
    throw new Error('missing screenshot evidence');
  }
  return true;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.length < 3) throw new Error('provide Lighthouse JSON paths');
  for (const file of process.argv.slice(2)) {
    assertLighthouseReport(JSON.parse(readFileSync(file, 'utf8')));
  }
  console.log(
    'Report validity passed; video review and budget comparison still required.'
  );
}
