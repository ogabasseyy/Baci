// @vitest-environment node
import sharp from 'sharp';
import { expect, it, vi } from 'vitest';

const run = vi.hoisted(() => vi.fn());
vi.mock('./local-oci-executor', () => ({ runLocalQualification: run }));

import { captureExperience } from './capture-route';

it('requires exact worker build, bounded safe semantics and native pixels keyed to the current catalog', async () => {
  const input = {
    manifest: {} as never,
    bundle: { digest: 'a'.repeat(64), javascript: '', css: '' },
    bootstrap: {
      route: { canonicalPath: '/' },
      catalog: { revision: 'r' },
    } as never,
    assets: [],
    assetsDigest: 'b'.repeat(64),
    engine: 'chromium' as const,
    width: 390,
  };
  const png = await sharp({
    create: { width: 8, height: 8, channels: 3, background: '#123456' },
  })
    .png()
    .toBuffer();
  const output = {
    status: 'passed',
    buildDigest: input.bundle.digest,
    screenshot: png.toString('base64'),
    semanticNodes: [{ tag: 'h1', children: [{ text: 'Synthetic' }] }],
  };
  run.mockResolvedValueOnce({ output, jobId: 'isolated' });
  const r = await captureExperience(input);
  expect(r.snapshot.key).toMatchObject({
    catalog: 'r',
    viewport: '390',
    browser: 'chromium',
  });
  expect(r.evidence.bytes.length).toBeGreaterThan(0);
  run.mockResolvedValueOnce({
    output: { ...output, semanticNodes: [{ tag: 'script', children: [] }] },
  });
  await expect(captureExperience(input)).rejects.toThrow();
  run.mockResolvedValueOnce({ output: { ...output, buildDigest: 'wrong' } });
  await expect(captureExperience(input)).rejects.toThrow('CAPTURE_FAILED');
});
