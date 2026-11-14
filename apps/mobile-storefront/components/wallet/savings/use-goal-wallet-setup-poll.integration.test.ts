import { act, renderHook } from '@testing-library/react-native';
import { fetchExistingSavingsPlanFunding } from '@/lib/customer-savings';
import { usePiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability';
import { useGoalWalletSetupPoll } from './use-goal-wallet-setup-poll';
import { useSavingsPlanFunding } from './use-savings-plan-funding';

jest.mock('@/lib/customer-savings', () => ({
  fetchExistingSavingsPlanFunding: jest.fn(),
  fetchSavingsPlanFunding: jest.fn(),
}));
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  usePiggyvestPrimaryCapability: jest.fn(),
}));

const read = jest.mocked(fetchExistingSavingsPlanFunding);
const pending = { status: 'pending' } as never;

// The same wiring the wallet section uses: real funding hook feeding the poll.
function useWired() {
  const funding = useSavingsPlanFunding({
    activeMerchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    goalId: 'goal-1',
    identityKey: 'user-a',
    loadExisting: true,
    notFoundMeansNotStarted: true,
  });
  useGoalWalletSetupPoll({
    phase: funding.planFundingPhase,
    scopeKey: 'user-a:goal-1',
    reread: funding.fetchExistingPlanFunding,
    onExhausted: funding.failExistingPlanFunding,
  });
  return funding;
}
const ticks = async (count: number) => {
  for (let tick = 0; tick < count; tick += 1)
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.mocked(usePiggyvestPrimaryCapability).mockReturnValue(true as never);
});
afterEach(() => jest.useRealTimers());

describe('setup poll with the real funding hook', () => {
  it('survives one failed silent read and reaches ready without a manual retry', async () => {
    read
      .mockResolvedValueOnce(pending)
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue({ status: 'ready' } as never);
    const { result } = renderHook(() => useWired());
    await act(async () => {});
    expect(result.current.planFundingPhase).toBe('pending');
    await ticks(1);
    expect(result.current.planFundingPhase).toBe('pending');
    await ticks(1);
    expect(result.current.planFundingPhase).toBe('ready');
  });

  it('shows the error only after all 12 attempts fail', async () => {
    read
      .mockResolvedValueOnce(pending)
      .mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useWired());
    await act(async () => {});
    await ticks(11);
    expect(result.current.planFundingPhase).toBe('pending');
    await ticks(1);
    expect(result.current.planFundingPhase).toBe('error');
    expect(result.current.fundingError).toBe('network down');
  });
});
