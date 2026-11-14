import { afterEach, describe, expect, it } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import {
  clearObservedPiggyvestPrimaryCapability,
  observePiggyvestPrimaryCapability,
} from '@/lib/piggyvest-primary-capability-cache';
import { useWalletPrimaryUnknown } from './use-wallet-primary-unknown';

const PILOT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const OTHER = '11111111-1111-4111-8111-111111111111';

jest.mock('@/lib/piggyvest-primary-capability', () => ({
  getPiggyvestPrimaryCapability: () => new Promise(() => undefined),
  usePiggyvestPrimaryCapability: () => null,
}));

afterEach(() => clearObservedPiggyvestPrimaryCapability());

describe('useWalletPrimaryUnknown with the server keeping PiggyVest off', () => {
  it("keeps today's wallet at any other store when the read fails", () => {
    const { result } = renderHook(() => useWalletPrimaryUnknown(OTHER, true));
    expect(result.current).toBe(false);
  });

  it("keeps today's wallet once the pilot is ruled out", () => {
    observePiggyvestPrimaryCapability(PILOT, false);
    const { result } = renderHook(() => useWalletPrimaryUnknown(PILOT, true));
    expect(result.current).toBe(false);
  });
});

describe('bugfix: unreachable PiggyVest read at the pilot (walk 10)', () => {
  it('reports the balance as unknown while the read failed', () => {
    const { result } = renderHook(() => useWalletPrimaryUnknown(PILOT, true));
    expect(result.current).toBe(true);
  });

  it('is not unknown when the read succeeded', () => {
    const { result } = renderHook(() => useWalletPrimaryUnknown(PILOT, false));
    expect(result.current).toBe(false);
  });
});
