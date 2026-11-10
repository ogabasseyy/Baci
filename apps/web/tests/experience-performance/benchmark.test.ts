import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { expect, it } from 'vitest';
import { experiencePerformanceReport } from '../../src/schemas/experience-performance';
import { runLocalQualification } from '../../tools/experience-runner/local-oci-executor';

const root = new URL(
  '../../../../.superpowers/sdd/2026-10-25-experience-cwv/artifacts/',
  import.meta.url
);
const read = (name: string) => readFileSync(new URL(name, root));
it.each([
  'client',
  'prerender',
] as const)('records honest host/frame cold lab diagnostics for %s', async (renderer) => {
  const samples = [];
  const load = { before: loadavg(), cpuCount: cpus().length };
  let browser = '';
  for (const width of [390, 1440]) {
    const proof = await runLocalQualification('prerender-checks', {
      html: read('index.html').toString(),
      javascript: read('app.js').toString(),
      css: read('app.css').toString(),
      baseline: read('baseline.js').toString(),
      bootstrap: JSON.parse(read('bootstrap.json').toString()),
      image: read('synthetic-device-image.png').toString('base64'),
      width,
      benchmark: renderer,
    });
    const { screenshot, har, trace, ...result } = proof.output as Record<
      string,
      unknown
    >;
    browser = String(result.browser);
    writeFileSync(
      new URL(`lab-${renderer}-${width}.har`, root),
      Buffer.from(String(har), 'base64')
    );
    writeFileSync(
      new URL(`lab-${renderer}-${width}-trace.zip`, root),
      Buffer.from(String(trace), 'base64')
    );
    writeFileSync(
      new URL(`lab-${renderer}-${width}.png`, root),
      Buffer.from(String(screenshot), 'base64')
    );
    writeFileSync(
      new URL(`lab-${renderer}-${width}.json`, root),
      JSON.stringify(
        { ...result, jobId: proof.jobId, wallMs: proof.wallMs },
        null,
        2
      )
    );
    expect(result.contentVisible).toBe(true);
    expect(result.imagesDecoded).toBe(true);
    expect(result.consoleErrors).toBe(0);
    samples.push({
      width,
      cache: 'cold-context',
      route: '/',
      frameLcpMs: result.frameLcpMs,
      hostLcpMs: result.hostLcpMs,
      frameCls: result.frameCls,
      hostCls: result.hostCls,
      interactionDurationMs: result.interactionDurationMs,
      contentVisible: true,
      imagesDecoded: true,
      consoleErrors: 0,
    });
  }
  const receipt = JSON.parse(read('receipt.json').toString());
  const hash = (value: string) =>
    createHash('sha256').update(value).digest('hex');
  const javascript = read(
    renderer === 'client' ? 'baseline.js' : 'app.js'
  ).toString();
  const report = experiencePerformanceReport.parse({
    format: 'baci.performance-lab/v1',
    buildDigest: hash(`${javascript}\0${read('app.css').toString()}`),
    sourceDigest: receipt.sourceDigest,
    measuredAt: new Date().toISOString(),
    renderer,
    environment: 'local-synthetic',
    cwvQualified: false,
    releaseQualified: false,
    contaminated: Math.max(...load.before, ...loadavg()) > load.cpuCount,
    browser,
    samples,
  });
  writeFileSync(
    new URL(`lab-${renderer}-report.json`, root),
    JSON.stringify(
      {
        report,
        load: { ...load, after: loadavg() },
        qualification:
          'diagnostic-only; one cold sample per viewport; no field INP, video or production-host qualification',
      },
      null,
      2
    )
  );
});
