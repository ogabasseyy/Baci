import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { runLocalQualification } from '../../tools/experience-runner/local-oci-executor';

const root = new URL(
  '../../../../.superpowers/sdd/2026-10-25-experience-cwv/artifacts/',
  import.meta.url
);
it.each([
  390, 1440,
])('renders Orbit without JS and hydrates its custom interaction at %ipx', async (width) => {
  const read = (name: string) => readFileSync(new URL(name, root));
  const proof = await runLocalQualification('prerender-checks', {
    html: read('index.html').toString(),
    javascript: read('app.js').toString(),
    css: read('app.css').toString(),
    baseline: read('baseline.js').toString(),
    bootstrap: JSON.parse(read('bootstrap.json').toString()),
    image: read('synthetic-device-image.png').toString('base64'),
    width,
  });
  const result = proof.output as {
    functionalOnly: boolean;
    cwvQualified: boolean;
    noJsHeading: string;
    baselineNoJsHeadingCount: number;
    hydration: string;
    colorInteraction: string;
    errors: string[];
    screenshot: string;
  };
  expect(result).toMatchObject({
    functionalOnly: true,
    cwvQualified: false,
    baselineNoJsHeadingCount: 0,
    hydration: 'ready',
    colorInteraction: 'Ink',
    errors: [],
  });
  expect(result.noJsHeading).toMatch(/orbit/i);
  const { screenshot, ...receipt } = result;
  mkdirSync(root, { recursive: true });
  writeFileSync(
    new URL(`no-js-${width}.png`, root),
    Buffer.from(screenshot, 'base64')
  );
  writeFileSync(
    new URL(`browser-${width}.json`, root),
    JSON.stringify(
      { ...receipt, jobId: proof.jobId, wallMs: proof.wallMs },
      null,
      2
    )
  );
});
