import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildClientHydrationEntrySource } from './client-hydration-template';

describe('client-hydration-template', () => {
  it('isolates full-code mode from published storefront baci-experience-connect handshakes while allowing preview origin', () => {
    const entrySrc = buildClientHydrationEntrySource(
      'src/App.tsx',
      {},
      [{ path: '/', view: 'home' }],
      undefined,
      'https://shop.ogabassey.com',
      'full-code'
    );
    let onMsg: ((ev: unknown) => void) | undefined;
    const parentWin = {};
    const stubBody = entrySrc
      .replace(
        "import { CommerceProvider, createCommerceClient } from '@baci/experience-sdk';",
        'const CommerceProvider = (p) => p.children; const createCommerceClient = (fn) => fn;'
      )
      .replace(
        "import { createElement, useEffect } from 'react';",
        'const createElement = () => ({}); const useEffect = () => {};'
      )
      .replace(
        "import { hydrateRoot } from 'react-dom/client';",
        'const hydrateRoot = () => ({ render: () => {} });'
      )
      .replace(
        'const mod = await import("./src/App.tsx");',
        'const mod = { default: () => null };'
      );
    vm.runInNewContext(stubBody, {
      URL,
      URLSearchParams,
      window: {
        location: { origin: 'null', assign: () => {} },
        parent: parentWin,
        addEventListener: (t: string, cb: (ev: unknown) => void) => {
          if (t === 'message') onMsg = cb;
        },
        removeEventListener: () => {},
      },
      document: {
        getElementById: (id: string) =>
          id === 'root'
            ? { addEventListener: () => {} }
            : {
                textContent:
                  '{"view":"home","pathname":"/","merchantSlug":"ogabassey","publicDataRevision":"1:1"}',
              },
      },
    });
    expect(onMsg).toBeDefined();
    const sent: unknown[] = [];
    onMsg?.({
      source: parentWin,
      origin: 'https://shop.ogabassey.com',
      data: {
        type: 'baci-experience-connect',
        nonce: 'n-fc',
        instanceId: 'i1',
        buildDigest: 'a'.repeat(64),
      },
      ports: [{ start: () => {}, postMessage: (m: unknown) => sent.push(m) }],
    });
    expect(sent).toHaveLength(0);

    onMsg?.({
      source: parentWin,
      origin: 'https://usebaci.com',
      data: {
        type: 'baci-experience-connect',
        nonce: 'n-preview',
        instanceId: 'i1',
        buildDigest: 'a'.repeat(64),
      },
      ports: [{ start: () => {}, postMessage: (m: unknown) => sent.push(m) }],
    });
    expect(sent[0]).toEqual({
      type: 'ready',
      nonce: 'n-preview',
      readiness: 'react-commit/v1',
    });
  });
});
