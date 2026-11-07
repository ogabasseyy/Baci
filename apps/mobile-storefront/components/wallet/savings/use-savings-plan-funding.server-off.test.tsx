import { act, renderHook } from '@testing-library/react-native';
import {
  fetchExistingSavingsPlanFunding,
  fetchSavingsPlanFunding,
} from '@/lib/customer-savings';
import { usePiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability';
import {
  SERVER_OFF_GOAL_ID,
  SERVER_OFF_MERCHANT_ID,
} from '@/test-support/piggyvest-server-off.test-support';
import { useSavingsPlanFunding } from './use-savings-plan-funding';

jest.mock('@/lib/customer-savings', () => ({
  fetchExistingSavingsPlanFunding: jest.fn(),
  fetchSavingsPlanFunding: jest.fn(),
}));
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  usePiggyvestPrimaryCapability: jest.fn(),
}));

const input = {
  activeMerchantId: SERVER_OFF_MERCHANT_ID,
  goalId: SERVER_OFF_GOAL_ID,
  identityKey: 'user-a',
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchSavingsPlanFunding).mockResolvedValue({
    status: 'pending',
  } as never);
});

// No verdict, a negative verdict or a failed probe all leave the hook on the
// legacy BVN flow, and it never reads status on its own.
describe.each([
  ['no verdict yet', null],
  ['a negative verdict', false],
])('server keeps PiggyVest off (%s)', (_name, verdict) => {
  beforeEach(() => {
    jest
      .mocked(usePiggyvestPrimaryCapability)
      .mockReturnValue(verdict as never);
  });

  it('collects a BVN and stays idle without a status lookup', async () => {
    const { result } = renderHook(() => useSavingsPlanFunding(input));
    await act(async () => {});
    expect(result.current.planFundingRequiresBvn).toBe(true);
    expect(result.current.planFundingPhase).toBe('idle');
    expect(fetchExistingSavingsPlanFunding).not.toHaveBeenCalled();
  });

  it('rejects a malformed BVN locally and provisions with a valid one', async () => {
    const { result } = renderHook(() => useSavingsPlanFunding(input));
    await act(async () => {
      await result.current.fetchPlanFunding('123');
    });
    expect(result.current.fundingError).toBe(
      'Enter the 11-digit BVN linked to this plan.'
    );
    expect(fetchSavingsPlanFunding).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.fetchPlanFunding('00000000000');
    });
    expect(fetchSavingsPlanFunding).toHaveBeenCalledWith(
      expect.objectContaining({
        bvn: '00000000000',
        goalId: SERVER_OFF_GOAL_ID,
      })
    );
  });
});

describe('server keeps PiggyVest off (silent re-read)', () => {
  it('a hook that never asked for a status read stays idle', async () => {
    jest.mocked(usePiggyvestPrimaryCapability).mockReturnValue(false as never);
    const { result } = renderHook(() => useSavingsPlanFunding(input));
    await act(async () => {});
    expect(result.current.planFundingPhase).toBe('idle');
    expect(fetchExistingSavingsPlanFunding).not.toHaveBeenCalled();
  });
});
