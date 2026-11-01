import { builderDesignCapabilities } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { createNativePreviewController } from './native-preview-controller';

const nonce = 'a'.repeat(32);
const ready = {
  type: 'baci.builder-preview.native-ready',
  version: 2,
  sessionNonce: nonce,
  capabilityHash: builderDesignCapabilities.capabilityHash,
  capabilityVersion: builderDesignCapabilities.capabilityVersion,
};
const rendered = (revision: number) => ({
  type: 'baci.builder-preview.native-rendered',
  version: 2,
  sessionNonce: nonce,
  revision,
});

describe('native preview host session', () => {
  it('accepts only matching session responses and the latest revision', () => {
    const session = createNativePreviewController(nonce);
    expect(session.begin(1)).toBe(false);
    expect(
      session.receive(
        JSON.stringify({ ...ready, sessionNonce: 'b'.repeat(32) })
      )
    ).toBeNull();
    expect(session.receive(JSON.stringify(ready))).toBe('ready');
    expect(session.begin(1)).toBe(true);
    expect(session.begin(2)).toBe(true);
    expect(session.receive(JSON.stringify(rendered(1)))).toBeNull();
    expect(session.receive(JSON.stringify(rendered(2)))).toBe('rendered');
    expect(session.receive(JSON.stringify(rendered(2)))).toBeNull();
    expect(session.begin(2)).toBe(false);
  });
  it('keeps the last successful revision across errors and timeouts', () => {
    const session = createNativePreviewController(nonce);
    session.receive(JSON.stringify(ready));
    session.begin(1);
    session.receive(JSON.stringify(rendered(1)));
    session.begin(2);
    expect(
      session.receive(
        JSON.stringify({
          type: 'baci.builder-preview.native-error',
          version: 2,
          sessionNonce: nonce,
          revision: 2,
          code: 'render_failed',
        })
      )
    ).toBe('error');
    expect(session.lastRendered()).toBe(1);
    session.begin(3);
    expect(session.timeout(2)).toBe(false);
    expect(session.timeout(3)).toBe(true);
    expect(session.lastRendered()).toBe(1);
    expect(session.receive(JSON.stringify(rendered(3)))).toBeNull();
  });
});
