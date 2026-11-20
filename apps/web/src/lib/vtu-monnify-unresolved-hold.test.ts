import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  markVtuMonnifyUnresolvedHold,
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
