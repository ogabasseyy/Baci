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

describe('expired-claim status reading', () => {
  const read = async (answer: unknown, change = {}) => {
    jest
      .mocked(fetchExistingSavingsPlanFunding)
      .mockResolvedValue(answer as never);
    const { result } = renderHook(() =>
      useSavingsPlanFunding({ ...input, ...change })
    );
    await act(async () => {
      await result.current.fetchExistingPlanFunding();
    });
    return result.current.planFundingPhase;
  };

  it('reports a pending answer flagged retryable as setup_retryable', async () => {
    expect(await read({ status: 'pending', setupRetryable: true })).toBe(
      'setup_retryable'
    );
  });

  it.each([
    [{ status: 'pending', setupRetryable: false }],
    [{ status: 'pending' }],
  ])('keeps a live claim %j as pending', async (answer) => {
    expect(await read(answer)).toBe('pending');
  });

  it('never reports retryable for a caller that did not ask for setup status', async () => {
    expect(
      await read(
        { status: 'pending', setupRetryable: true },
        { notFoundMeansNotStarted: false }
      )
    ).toBe('pending');
  });

  it('never reports a ready answer as retryable', async () => {
    expect(await read({ status: 'ready', setupRetryable: true })).toBe('ready');
  });
});

describe('silent status re-read', () => {
  it('keeps the current phase while in flight, then applies the answer', async () => {
    jest
      .mocked(fetchExistingSavingsPlanFunding)
      .mockResolvedValueOnce({ status: 'pending' } as never);
    const { result } = renderHook(() => useSavingsPlanFunding(input));
    await act(async () => {
      await result.current.fetchExistingPlanFunding();
    });
    expect(result.current.planFundingPhase).toBe('pending');
    let finish: (value: never) => void = () => {};
    jest.mocked(fetchExistingSavingsPlanFunding).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve as never;
      })
    );
    let read: Promise<void> = Promise.resolve();
    act(() => {
      read = result.current.fetchExistingPlanFunding({ silent: true });
    });
    expect(result.current.planFundingPhase).toBe('pending');
    await act(async () => {
      finish({ status: 'ready' } as never);
      await read;
    });
    expect(result.current.planFundingPhase).toBe('ready');
  });

  it('rejects a failed silent read without flipping the phase to error', async () => {
    jest
      .mocked(fetchExistingSavingsPlanFunding)
      .mockResolvedValueOnce({ status: 'pending' } as never);
    const { result } = renderHook(() => useSavingsPlanFunding(input));
    await act(async () => {
      await result.current.fetchExistingPlanFunding();
    });
    jest
      .mocked(fetchExistingSavingsPlanFunding)
      .mockRejectedValueOnce(new Error('network down'));
    await act(async () => {
      await expect(
        result.current.fetchExistingPlanFunding({ silent: true })
      ).rejects.toThrow('network down');
    });
    expect(result.current.planFundingPhase).toBe('pending');
    expect(result.current.fundingError).toBeNull();
    act(() =>
      result.current.failExistingPlanFunding(new Error('network down'))
    );
    expect(result.current.planFundingPhase).toBe('error');
    expect(result.current.fundingError).toBe('network down');
  });
});
