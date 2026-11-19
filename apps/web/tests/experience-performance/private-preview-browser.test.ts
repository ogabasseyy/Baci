import { readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { runLocalQualification } from '../../tools/experience-runner/local-oci-executor';

const root = new URL(
  '../../../../.superpowers/sdd/2026-10-25-experience-prerender-mcp/',
  import.meta.url
);
it.each([
  390, 1440,
])('normal MCP-produced private preview paints without JS and hydrates custom interactions at %ipx', async (width) => {
  const captured = JSON.parse(
    readFileSync(new URL('private-launch.json', root), 'utf8')
  );
  const proof = await runLocalQualification('prerender-private-checks', {
    ...captured,
    width,
  });
  const { screenshot, staticScreenshot, ...result } = proof.output as Record<
    string,
    unknown
  >;
  expect(result).toMatchObject({
    noJsContent: true,
    hydration: 'ready',
    customInteraction: 'Count 1',
    errors: [],
    cwvQualified: false,
    buildDigest: captured.buildDigest,
    sourceDigest: captured.sourceDigest,
  });
  writeFileSync(
    new URL(`private-${width}.png`, root),
    Buffer.from(String(screenshot), 'base64')
  );
  writeFileSync(
    new URL(`private-no-js-${width}.png`, root),
    Buffer.from(String(staticScreenshot), 'base64')
  );
  writeFileSync(
    new URL(`private-browser-${width}.json`, root),
    JSON.stringify(
      { ...result, jobId: proof.jobId, wallMs: proof.wallMs },
      null,
      2
    )
  );
});
