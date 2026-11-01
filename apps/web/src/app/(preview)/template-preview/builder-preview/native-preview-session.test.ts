import { builderDesignCapabilities } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { createNativePreviewSession } from './native-preview-session';

const nonce = 'a'.repeat(32);
const init = {
  type: 'baci.builder-preview.native-init',
  version: 2,
  sessionNonce: nonce,
};
const render = {
  type: 'baci.builder-preview.native-render',
  version: 2,
  sessionNonce: nonce,
  revision: 1,
  merchant: { id: 'merchant-1', slug: 'acme' },
  candidateConfig: { content: [], root: { props: { title: 'Home' } } },
  capabilityHash: builderDesignCapabilities.capabilityHash,
  capabilityVersion: builderDesignCapabilities.capabilityVersion,
};

describe('native preview session', () => {
  it('requires an initialized session and monotonically increasing revisions', () => {
    const session = createNativePreviewSession();
    expect(session.accept(JSON.stringify(render))).toBeNull();
    expect(session.accept(JSON.stringify(init))).toMatchObject({
      kind: 'ready',
      sessionNonce: nonce,
    });
    expect(session.accept(JSON.stringify(init))).toMatchObject({
      kind: 'ready',
      sessionNonce: nonce,
    });
    expect(
      session.accept(JSON.stringify({ ...init, sessionNonce: 'b'.repeat(32) }))
    ).toBeNull();
    expect(
      session.accept(
        JSON.stringify({ ...render, sessionNonce: 'b'.repeat(32) })
      )
    ).toBeNull();
    expect(session.accept(JSON.stringify(render))).toMatchObject({
      kind: 'render',
      message: { revision: 1 },
    });
    expect(session.accept(JSON.stringify(render))).toBeNull();
    expect(
      session.accept(JSON.stringify({ ...render, revision: 2 }))
    ).toMatchObject({ kind: 'render' });
  });
  it('rotates only with the previous nonce and rejects the old session', () => {
    const session = createNativePreviewSession();
    const nextNonce = 'b'.repeat(32);
    session.accept(JSON.stringify(init));
    session.accept(JSON.stringify(render));
    expect(
      session.accept(
        JSON.stringify({
          ...init,
          sessionNonce: nextNonce,
          previousSessionNonce: 'c'.repeat(32),
        })
      )
    ).toBeNull();
    expect(
      session.accept(
        JSON.stringify({
          ...init,
          sessionNonce: nextNonce,
          previousSessionNonce: nonce,
        })
      )
    ).toMatchObject({ kind: 'ready', sessionNonce: nextNonce });
    expect(session.accept(JSON.stringify(render))).toBeNull();
    expect(
      session.accept(JSON.stringify({ ...render, sessionNonce: nextNonce }))
    ).toMatchObject({ kind: 'render' });
    expect(
      session.accept(JSON.stringify({ ...init, previousSessionNonce: nonce }))
    ).toBeNull();
  });
  it('rejects oversized, malformed and unapproved payloads without updating revision', () => {
    const session = createNativePreviewSession();
    session.accept(JSON.stringify(init));
    expect(session.accept('x'.repeat(2_000_000))).toBeNull();
    expect(session.accept('{')).toBeNull();
    expect(
      session.accept(JSON.stringify({ ...render, capabilityHash: 'stale' }))
    ).toBeNull();
    expect(session.accept(JSON.stringify(render))).toMatchObject({
      kind: 'render',
    });
  });
});
