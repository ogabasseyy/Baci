import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildFramedHostPortSnippet } from './host-port-snippet';

describe('host-port-snippet', () => {
  it('gates baci-experience-connect by composable vs full-code mode and emits ready + render-committed', () => {
    let onMsg: ((ev: unknown) => void) | undefined;
    const parentWin = {};
    const ctx: Record<string, unknown> = {
      window: {
        parent: parentWin,
        addEventListener: (_t: string, cb: (ev: unknown) => void) => {
          onMsg = cb;
        },
        removeEventListener: () => {},
      },
      document: {
        getElementById: () => ({ textContent: '{"merchantSlug":"ogabassey"}' }),
      },
      Date,
      Number,
      String,
      Array,
      Set,
      Map,
      Promise,
      JSON,
    };
    vm.runInNewContext(
      `${buildFramedHostPortSnippet(undefined, 'https://shop.ogabassey.com', 'composable')}\nglobalThis.commit = notifyHostRenderCommitted;`,
      ctx
    );
    const posted: Record<string, unknown>[] = [];
    let portOnMessage: ((ev: { data: unknown }) => void) | undefined;
    const fakePort = {
      start: () => {},
      postMessage: (m: Record<string, unknown>) => posted.push(m),
      set onmessage(fn: (ev: { data: unknown }) => void) {
        portOnMessage = fn;
      },
    };
    onMsg?.({
      source: parentWin,
      origin: 'https://shop.ogabassey.com',
      data: {
        type: 'baci-experience-connect',
        nonce: 'n1',
        instanceId: 'i1',
        buildDigest: 'd1',
      },
      ports: [fakePort],
    });
    expect(posted[0]).toEqual({
      type: 'ready',
      nonce: 'n1',
      readiness: 'react-commit/v1',
    });
    portOnMessage?.({
      data: { type: 'bootstrap', bootstrap: { route: { epoch: 2 } } },
    });
    (ctx.commit as (ep?: number) => void)(2);
    expect(posted[1]).toEqual({
      type: 'render-committed',
      nonce: 'n1',
      epoch: 2,
    });
  });
});
