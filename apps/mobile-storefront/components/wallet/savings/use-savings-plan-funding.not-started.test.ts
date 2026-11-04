import { act, renderHook } from '@testing-library/react-native';
import { fetchExistingSavingsPlanFunding } from '@/lib/customer-savings';
import { usePiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability';
import { useSavingsPlanFunding } from './use-savings-plan-funding';

jest.mock('@/lib/customer-savings', () => ({
  fetchExistingSavingsPlanFunding: jest.fn(),
  fetchSavingsPlanFunding: jest.fn(),
}));
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  usePiggyvestPrimaryCapability: jest.fn(),
}));

const input = {
  activeMerchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  goalId: 'goal-1',
  identityKey: 'user-a',
  notFoundMeansNotStarted: true,
};
const notFound = () =>
  Object.assign(new Error('not found'), { code: 'SAVINGS_WALLET_NOT_FOUND' });

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(usePiggyvestPrimaryCapability).mockReturnValue(true as never);
});

describe('not-started status reading', () => {
  it('reports a never-started goal as not_started, distinct from pending', async () => {
    jest.mocked(fetchExistingSavingsPlanFunding).mockRejectedValue(notFound());
    const { result } = renderHook(() => useSavingsPlanFunding(input));
    await act(async () => {
      await result.current.fetchExistingPlanFunding();
    });
    expect(result.current.planFundingPhase).toBe('not_started');
    expect(result.current.fundingError).toBeNull();
  });

  it('keeps a real pending answer as pending', async () => {
    jest
      .mocked(fetchExistingSavingsPlanFunding)
      .mockResolvedValue({ status: 'pending' } as never);
    const { result } = renderHook(() => useSavingsPlanFunding(input));
    await act(async () => {
      await result.current.fetchExistingPlanFunding();
    });
    expect(result.current.planFundingPhase).toBe('pending');
  });

  it('reads other failures as errors, never as not started', async () => {
    jest
      .mocked(fetchExistingSavingsPlanFunding)
      .mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useSavingsPlanFunding(input));
    await act(async () => {
      await result.current.fetchExistingPlanFunding();
    });
    expect(result.current.planFundingPhase).toBe('error');
  });

  it('is loading, not started, while the status read is in flight', async () => {
    let finish: (value: never) => void = () => {};
    jest.mocked(fetchExistingSavingsPlanFunding).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve as never;
      })
    );
    const { result } = renderHook(() => useSavingsPlanFunding(input));
    let read: Promise<void> = Promise.resolve();
    act(() => {
      read = result.current.fetchExistingPlanFunding();
    });
    expect(result.current.planFundingPhase).toBe('loading');
    await act(async () => {
      finish({ status: 'pending' } as never);
      await read;
    });
  });
});
