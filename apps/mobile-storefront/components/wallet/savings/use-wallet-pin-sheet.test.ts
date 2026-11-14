import { createHash } from 'node:crypto';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  fetchWalletPinStatus,
  submitWalletPin,
  verifyFundPin,
  verifyGoalActionPin,
} from '@/lib/wallet-pin-api';
import { useWalletPinSheet } from './use-wallet-pin-sheet';

jest.mock('@/lib/wallet-pin-api');

const proof = createHash('sha256').update('s5m-hook-proof').digest('hex');
const request = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  goalId: '22222222-2222-4222-8222-222222222222',
  operationId: '33333333-3333-4333-8333-333333333333',
  amountKobo: 250000,
};

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(fetchWalletPinStatus).mockResolvedValue({
    primary: true,
    hasPin: true,
    resetRequired: false,
    available: true,
  });
});

describe('a PIN check that is still in flight', () => {
  it('is dropped when the sheet was closed and re-opened before it answered', async () => {
    let answerOld: (value: string) => void = () => undefined;
    jest.mocked(verifyFundPin).mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          answerOld = resolve;
        })
    );
    const onProof = jest.fn();
    const { result, rerender } = renderHook(
      (props: { open: boolean }) =>
        useWalletPinSheet({
          request: props.open ? request : null,
          onProof,
        }),
      { initialProps: { open: true } }
    );
    await waitFor(() => expect(result.current.step).toBe('enter'));
    act(() => result.current.setPin('4821'));
    act(() => {
      void result.current.submit();
    });
    expect(verifyFundPin).toHaveBeenCalledTimes(1);

    rerender({ open: false });
    rerender({ open: true });
    await waitFor(() => expect(result.current.step).toBe('enter'));

    await act(async () => {
      answerOld(proof);
    });
    expect(onProof).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
  });

  it('still hands back the proof when nothing changed in between', async () => {
    jest.mocked(verifyFundPin).mockResolvedValue(proof);
    const onProof = jest.fn();
    const { result } = renderHook(() =>
      useWalletPinSheet({ request, onProof })
    );
    await waitFor(() => expect(result.current.step).toBe('enter'));
    act(() => result.current.setPin('4821'));
    await act(async () => {
      await result.current.submit();
    });
    expect(onProof).toHaveBeenCalledWith(proof);
  });

  it('does not let a late save answer change the re-opened sheet', async () => {
    jest.mocked(fetchWalletPinStatus).mockResolvedValue({
      primary: true,
      hasPin: false,
      resetRequired: false,
      available: true,
    });
    let finishSave: () => void = () => undefined;
    jest.mocked(submitWalletPin).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        })
    );
    const { result, rerender } = renderHook(
      (props: { open: boolean }) =>
        useWalletPinSheet({
          request: props.open ? request : null,
          onProof: jest.fn(),
        }),
      { initialProps: { open: true } }
    );
    await waitFor(() => expect(result.current.step).toBe('set'));
    act(() => {
      result.current.setPin('4821');
      result.current.setConfirmPin('4821');
    });
    act(() => {
      void result.current.submit();
    });
    rerender({ open: false });
    rerender({ open: true });
    await waitFor(() => expect(result.current.step).toBe('set'));
    await act(async () => {
      finishSave();
    });
    expect(result.current.step).toBe('set');
    expect(result.current.notice).toBeNull();
  });
});

describe('bugfix: a remounted PIN panel', () => {
  it('drops an answer that arrives after the panel unmounted', async () => {
    let answerOld: (value: string) => void = () => undefined;
    jest.mocked(verifyFundPin).mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          answerOld = resolve;
        })
    );
    const onProof = jest.fn();
    const { result, unmount } = renderHook(() =>
      useWalletPinSheet({ request, onProof })
    );
    await waitFor(() => expect(result.current.step).toBe('enter'));
    act(() => result.current.setPin('4821'));
    act(() => {
      void result.current.submit();
    });
    unmount();
    await act(async () => {
      answerOld(proof);
    });
    expect(onProof).not.toHaveBeenCalled();
  });
});

describe('request identity', () => {
  it('drops an in-flight answer when the replacement shares the operation id but not the amount', async () => {
    let answerOld: (value: string) => void = () => undefined;
    jest.mocked(verifyFundPin).mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          answerOld = resolve;
        })
    );
    const onProof = jest.fn();
    const { result, rerender } = renderHook(
      (props: { amountKobo: number }) =>
        useWalletPinSheet({
          request: { ...request, amountKobo: props.amountKobo },
          onProof,
        }),
      { initialProps: { amountKobo: 250000 } }
    );
    await waitFor(() => expect(result.current.step).toBe('enter'));
    act(() => result.current.setPin('4821'));
    act(() => {
      void result.current.submit();
    });
    rerender({ amountKobo: 300000 });
    await waitFor(() => expect(result.current.step).toBe('enter'));
    await act(async () => {
      answerOld(proof);
    });
    expect(onProof).not.toHaveBeenCalled();
  });

  it('sends the initiating account on every call', async () => {
    jest.mocked(verifyFundPin).mockResolvedValue(proof);
    const { result } = renderHook(() =>
      useWalletPinSheet({
        request,
        expectedUserId: 'user-opened',
        onProof: jest.fn(),
      })
    );
    await waitFor(() => expect(result.current.step).toBe('enter'));
    expect(fetchWalletPinStatus).toHaveBeenCalledWith('user-opened');
    act(() => result.current.setPin('4821'));
    await act(async () => {
      await result.current.submit();
    });
    expect(verifyFundPin).toHaveBeenCalledWith(
      expect.objectContaining({ pin: '4821' }),
      'user-opened'
    );
  });
});

describe('a goal-action request', () => {
  it('restarts the sheet when only the action changes and verifies without an amount', async () => {
    jest.mocked(verifyGoalActionPin).mockResolvedValue(proof);
    const onProof = jest.fn();
    const goal = {
      merchantId: request.merchantId,
      goalId: request.goalId,
      operationId: request.operationId,
    };
    const { result } = renderHook(() =>
      useWalletPinSheet({
        request: { ...goal, action: 'complete' },
        onProof,
        expectedUserId: 'user-a',
      })
    );
    await waitFor(() => expect(result.current.step).toBe('enter'));
    act(() => result.current.setPin('4821'));
    await act(async () => {
      await result.current.submit();
    });
    expect(verifyGoalActionPin).toHaveBeenCalledWith(
      { ...goal, action: 'complete', pin: '4821' },
      'user-a'
    );
    expect(verifyFundPin).not.toHaveBeenCalled();
    expect(onProof).toHaveBeenCalledWith(proof);
  });
});

describe('a goal action whose operation is no longer valid', () => {
  it.each([
    'CANCEL_OPERATION_INVALID',
    'COMPLETE_OPERATION_INVALID',
  ])('hands %s up instead of leaving the customer in the sheet', async (code) => {
    jest.mocked(verifyGoalActionPin).mockRejectedValue(
      Object.assign(new Error('No longer valid. Please start again.'), {
        code,
      })
    );
    const onProof = jest.fn();
    const onInvalid = jest.fn();
    const { result } = renderHook(() =>
      useWalletPinSheet({
        request: {
          action: 'cancel',
          merchantId: request.merchantId,
          goalId: request.goalId,
          operationId: request.operationId,
        },
        onProof,
        onInvalid,
      })
    );
    await waitFor(() => expect(result.current.step).toBe('enter'));
    act(() => result.current.setPin('4821'));
    await act(async () => {
      await result.current.submit();
    });
    expect(onInvalid).toHaveBeenCalledWith(
      'No longer valid. Please start again.'
    );
    expect(onProof).not.toHaveBeenCalled();
    expect(result.current.pin).toBe('');
  });
});
