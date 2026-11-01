import { builderDesignCapabilities } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { parseNativePreviewResponse } from './native-preview-response';

const nonce = 'a'.repeat(32);
describe('native preview responses', () => {
  it('accepts a valid session-bound readiness response', () => {
    expect(
      parseNativePreviewResponse(
        JSON.stringify({
          type: 'baci.builder-preview.native-ready',
          version: 2,
          sessionNonce: nonce,
          capabilityHash: builderDesignCapabilities.capabilityHash,
          capabilityVersion: builderDesignCapabilities.capabilityVersion,
        })
      )
    ).toMatchObject({ type: 'baci.builder-preview.native-ready' });
  });
  it('rejects malformed, oversized and invalid responses', () => {
    expect(parseNativePreviewResponse('{')).toBeNull();
    expect(parseNativePreviewResponse('x'.repeat(4097))).toBeNull();
    expect(
      parseNativePreviewResponse(
        JSON.stringify({
          type: 'baci.builder-preview.native-rendered',
          version: 2,
          sessionNonce: 'bad',
          revision: 1,
        })
      )
    ).toBeNull();
  });
});
