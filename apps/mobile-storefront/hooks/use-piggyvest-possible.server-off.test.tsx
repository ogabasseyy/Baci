import { describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { usePiggyvestPossible } from './use-piggyvest-possible';

let mockCapability: boolean | null = false;
const mockSeen: unknown[] = [];
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  usePiggyvestPrimaryCapability: (merchantId: unknown) => {
    mockSeen.push(merchantId);
    return mockCapability;
  },
}));
jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_ID: 'config-merchant' },
}));

describe('usePiggyvestPossible', () => {
  it('is false once the server rules PiggyVest out', () => {
    mockCapability = false;
    const { result } = renderHook(() => usePiggyvestPossible('merchant-1'));
    expect(result.current).toBe(false);
  });

  it('stays possible while the verdict is unknown for the Ogabassey pilot', () => {
    mockCapability = null;
    const { result } = renderHook(() =>
      usePiggyvestPossible('6b5cb8a4-5575-456c-b936-8cdfae30db74')
    );
    expect(result.current).toBe(true);
  });

  it('owner decision: is not possible for any other merchant while unknown', () => {
    mockCapability = null;
    const { result } = renderHook(() => usePiggyvestPossible('merchant-1'));
    expect(result.current).toBe(false);
  });

  it('falls back to the configured merchant like the wallet reads', () => {
    mockCapability = false;
    renderHook(() => usePiggyvestPossible(''));
    expect(mockSeen.at(-1)).toBe('config-merchant');
  });
});
