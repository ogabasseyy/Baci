import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  markVtuMonnifyUnresolvedHold,
  VTU_MONNIFY_HELD_TOKEN_SEEN_KEY,
  VTU_MONNIFY_OUTCOME_UNRESOLVED_KEY,
} from './vtu-monnify-unresolved-hold';

afterEach(() => vi.restoreAllMocks());

describe('markVtuMonnifyUnresolvedHold', () => {
  it('flags a held result and logs only a fixed label', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const metadata: Record<string, unknown> = {};

    markVtuMonnifyUnresolvedHold({
      metadata,
      result: { providerOutcomeUnresolved: true },
      transactionId: 'vtu-1',
    });

    expect(metadata[VTU_MONNIFY_OUTCOME_UNRESOLVED_KEY]).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.any(String), {
      requeryable: false,
      tokenSeen: false,
      transactionId: 'vtu-1',
    });
  });

  it('reports a requeryable hold when Monnify gave a vendReference', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    markVtuMonnifyUnresolvedHold({
      metadata: {},
      result: {
        providerOutcomeUnresolved: true,
        providerVendReference: 'MFBP-1',
      },
      transactionId: 'vtu-1',
    });

    expect(warn).toHaveBeenCalledWith(expect.any(String), {
      requeryable: true,
      tokenSeen: false,
      transactionId: 'vtu-1',
    });
  });

  it('leaves an ordinary result untouched', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const metadata: Record<string, unknown> = {};

    markVtuMonnifyUnresolvedHold({
      metadata,
      result: {},
      transactionId: 'vtu-1',
    });

    expect(metadata).toEqual({});
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('bugfix: a held answer that carried a token is flagged, without storing it', () => {
  it('sets monnifyHeldTokenSeen and logs the fact (no token value)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const metadata: Record<string, unknown> = {};

    markVtuMonnifyUnresolvedHold({
      metadata,
      result: { providerOutcomeUnresolved: true, providerTokenSeen: true },
      transactionId: 'vtu-1',
    });

    expect(metadata[VTU_MONNIFY_HELD_TOKEN_SEEN_KEY]).toBe(true);
    expect(JSON.stringify(Object.values(metadata))).not.toMatch(/\d{4}-\d{4}/);
    expect(warn).toHaveBeenCalledWith(expect.any(String), {
      requeryable: false,
      tokenSeen: true,
      transactionId: 'vtu-1',
    });
  });

  it('does not set the flag when no token was seen', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const metadata: Record<string, unknown> = {};

    markVtuMonnifyUnresolvedHold({
      metadata,
      result: { providerOutcomeUnresolved: true },
      transactionId: 'vtu-1',
    });

    expect(VTU_MONNIFY_HELD_TOKEN_SEEN_KEY in metadata).toBe(false);
  });
});

describe('bugfix: a token seen on a still-pending answer is flagged too', () => {
  it('sets monnifyHeldTokenSeen even when the result is not marked unresolved', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const metadata: Record<string, unknown> = {};

    markVtuMonnifyUnresolvedHold({
      metadata,
      result: { providerTokenSeen: true, providerVendReference: 'MFBP-1' },
      transactionId: 'vtu-1',
    });

    expect(metadata[VTU_MONNIFY_HELD_TOKEN_SEEN_KEY]).toBe(true);
    expect(VTU_MONNIFY_OUTCOME_UNRESOLVED_KEY in metadata).toBe(false);
  });
});
