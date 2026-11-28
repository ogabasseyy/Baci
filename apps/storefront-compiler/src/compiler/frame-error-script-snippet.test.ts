import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildFrameErrorAsset } from './frame-error-script-snippet';

describe('frame-error-script-snippet', () => {
  it('versions asset path by origin config and posts ready + render-failed only to allowed parent origins', () => {
    const comp = buildFrameErrorAsset({
      merchantSlug: 'ogabassey',
      hostOrigin: 'https://shop.ogabassey.com',
      mode: 'composable',
    });
    const full = buildFrameErrorAsset({
      merchantSlug: 'ogabassey',
      hostOrigin: 'https://shop.ogabassey.com',
      mode: 'full-code',
    });
    expect(comp.path).not.toBe(full.path);

    let onMsg: ((ev: unknown) => void) | undefined;
    const parentWin = {};
    vm.runInNewContext(full.source, {
      window: {
        parent: parentWin,
        addEventListener: (_t: string, cb: (ev: unknown) => void) => {
          onMsg = cb;
        },
        removeEventListener: () => {},
      },
    });
    const posted: unknown[] = [];
    onMsg?.({
      source: parentWin,
      origin: 'https://shop.ogabassey.com',
      data: {
        type: 'baci-experience-connect',
        nonce: 'n1',
        instanceId: 'i1',
        buildDigest: 'd1',
      },
      ports: [{ start: () => {}, postMessage: (m: unknown) => posted.push(m) }],
    });
    expect(posted).toHaveLength(0);

    onMsg?.({
      source: parentWin,
      origin: 'https://usebaci.com',
      data: {
        type: 'baci-experience-connect',
        nonce: 'n2',
        instanceId: 'i1',
        buildDigest: 'd1',
      },
      ports: [{ start: () => {}, postMessage: (m: unknown) => posted.push(m) }],
    });
    expect(posted).toEqual([
      { type: 'ready', nonce: 'n2', readiness: 'react-commit/v1' },
      { type: 'render-failed', nonce: 'n2', code: 'HYDRATION_FAILED' },
    ]);
  });
});
