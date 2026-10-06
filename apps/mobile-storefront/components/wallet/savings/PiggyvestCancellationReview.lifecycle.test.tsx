import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { PiggyvestCancellationReview as CancellationReview } from './PiggyvestCancellationReview';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

const goalId = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const quote = {
  status: 'quote_available',
  goalId,
  revisionId: goalId,
  termsVersion: 'synthetic-v1',
  termsHash: 'a'.repeat(64),
  consentVersion: '2026-09-11',
  principalKobo: 10000,
  paidInterestKobo: 100,
  pendingInterestKobo: 200,
  interestDisposition: 'unresolved',
  dispatch: 'contract_gap',
};
const receipt = {
  status: 'prepared',
  goalId,
  operationId,
  collectionPaused: true,
  dispatch: 'contract_gap',
  interestDisposition: 'unresolved',
};
const props = { sessionKey: 'synthetic-session', goalId, operationId, quote };
async function accept() {
  await act(async () => {
    fireEvent.press(screen.getByRole('checkbox'));
  });
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Prepare cancellation' })
    );
  });
}

describe('native cancellation unmount', () => {
  it.each([
    'success',
    'failure',
  ])('ignores late %s after unmount without dispatching again', async (outcome) => {
    let complete: (value: unknown) => void = () => undefined;
    let fail: (error: Error) => void = () => undefined;
    const onPrepare = jest.fn(
      () =>
        new Promise((resolve, reject) => {
          complete = resolve;
          fail = reject;
        })
    );
    const view = render(
      <CancellationReview {...props} onPrepare={onPrepare} />
    );
    await accept();
    view.unmount();
    await act(async () => {
      if (outcome === 'success') complete(receipt);
      else fail(new Error('private'));
    });
    expect(onPrepare).toHaveBeenCalledTimes(1);
    expect(view.toJSON()).toBeNull();
  });
});
