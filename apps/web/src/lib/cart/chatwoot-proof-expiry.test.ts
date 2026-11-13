import { describe, expect, it } from 'vitest';
import { resolveChatwootCartProofExpiry } from './chatwoot-proof-expiry';

describe('resolveChatwootCartProofExpiry', () => {
  it('caps at the earlier finite grant or cart expiry', () => {
    expect(
      resolveChatwootCartProofExpiry({
        cartExpiresAt: '2026-12-01T00:00:00.000Z',
        existingProofExpiresAt: '2026-11-20T00:00:00.000Z',
        liveGrantExpiresAt: '2026-11-25T00:00:00.000Z',
      })
    ).toBe('2026-11-25T00:00:00.000Z');
  });

  it('uses the existing proof as grant cap and still honors cart expiry', () => {
    expect(
      resolveChatwootCartProofExpiry({
        cartExpiresAt: '2026-11-17T00:00:00.000Z',
        existingProofExpiresAt: '2026-11-20T00:00:00.000Z',
        liveGrantExpiresAt: 'not-a-date',
      })
    ).toBe('2026-11-17T00:00:00.000Z');
  });

  it('fails closed when cart expiry is malformed', () => {
    expect(
      resolveChatwootCartProofExpiry({
        cartExpiresAt: 'not-a-date',
        existingProofExpiresAt: '2026-11-20T00:00:00.000Z',
        liveGrantExpiresAt: '2026-11-25T00:00:00.000Z',
      })
    ).toBeNull();
  });

  it('fails closed when the existing proof expiry is malformed', () => {
    expect(
      resolveChatwootCartProofExpiry({
        cartExpiresAt: '2026-12-01T00:00:00.000Z',
        existingProofExpiresAt: 'not-a-date',
      })
    ).toBeNull();
  });
});
