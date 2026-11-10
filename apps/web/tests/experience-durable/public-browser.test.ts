import { readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { runLocalQualification } from '../../tools/experience-runner/local-oci-executor';

const root = new URL(
  '../../../../.superpowers/sdd/2026-10-25-experience-durable/',
  import.meta.url
);
it.each([
  390, 1440,
])('durable normal-delivery Orbit renders without JS and hydrates at %ipx', async (width) => {
  const payload = JSON.parse(
    readFileSync(new URL('public-launch.json', root), 'utf8')
  );
  const proof = await runLocalQualification('durable-public-checks', {
    ...payload,
    width,
  });
  const { staticScreenshot, screenshot, ...result } = proof.output as Record<
    string,
    unknown
  >;
  expect(result).toMatchObject({
    noJsContent: true,
    hydration: 'ready',
    customInteraction: 'Ink',
    errors: [],
    cwvQualified: false,
  });
  writeFileSync(
    new URL(`public-no-js-${width}.png`, root),
    Buffer.from(String(staticScreenshot), 'base64')
  );
  writeFileSync(
    new URL(`public-${width}.png`, root),
    Buffer.from(String(screenshot), 'base64')
  );
  writeFileSync(
    new URL(`public-browser-${width}.json`, root),
    JSON.stringify(
      { ...result, jobId: proof.jobId, wallMs: proof.wallMs },
      null,
      2
    )
  );
});
