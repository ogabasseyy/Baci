import { jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import Colors from '@/constants/Colors';
import { SavingsCardContributionStatus } from './SavingsCardContributionStatus';

type Props = ComponentProps<typeof SavingsCardContributionStatus>;
function setup(overrides: Partial<Props> = {}) {
  const props: Props = {
    snapshot: {
      goalId: 'goal-1',
      savedMethodId: 'method-1',
      amountKobo: 25050,
      idempotencyKey: 'key-1',
      consent: { version: 'prefunded-card-v1', oneTimeCharge: true },
    },
    operationStatus: 'pending',
    allowRetry: false,
    busy: false,
    canStartNew: false,
    message: '',
    colors: Colors.light,
    onCheckStatus: jest.fn<() => void>(),
    onRetry: jest.fn<() => void>(),
    onNewContribution: jest.fn<() => void>(),
    ...overrides,
  };
  render(<SavingsCardContributionStatus {...props} />);
  return props;
}

it.each([
  null,
  'pending',
] as const)('checks saved-request status and retries only when permitted for %s', (operationStatus) => {
  const props = setup({ operationStatus, allowRetry: true });
  fireEvent.press(
    screen.getByRole('button', { name: 'Check card contribution status' })
  );
  fireEvent.press(
    screen.getByRole('button', { name: 'Retry same card contribution request' })
  );
  expect(props.onCheckStatus).toHaveBeenCalledTimes(1);
  expect(props.onRetry).toHaveBeenCalledTimes(1);
});

it('does not offer retry without explicit permission', () => {
  setup();
  expect(
    screen.queryByRole('button', {
      name: 'Retry same card contribution request',
    })
  ).toBeNull();
});

it.each([
  'completed',
  'collection_failed',
  'reconciliation_required',
] as const)('does not offer status checks or same-request retry for %s', (operationStatus) => {
  setup({ operationStatus, allowRetry: true });
  expect(screen.queryAllByRole('button')).toHaveLength(0);
});

it('requires a durable saved request for status or retry actions', () => {
  setup({ snapshot: null, allowRetry: true });
  expect(screen.queryAllByRole('button')).toHaveLength(0);
});

it('offers a new contribution only when the controller permits it', () => {
  const props = setup({ operationStatus: 'completed', canStartNew: true });
  fireEvent.press(
    screen.getByRole('button', { name: 'Start a new card contribution' })
  );
  expect(props.onNewContribution).toHaveBeenCalledTimes(1);
});

it('blocks status, retry, and new-contribution actions while busy', () => {
  const props = setup({ allowRetry: true, canStartNew: true, busy: true });
  for (const button of screen.getAllByRole('button')) {
    expect(button).toBeDisabled();
    fireEvent.press(button);
  }
  expect(props.onCheckStatus).not.toHaveBeenCalled();
  expect(props.onRetry).not.toHaveBeenCalled();
  expect(props.onNewContribution).not.toHaveBeenCalled();
});

it('announces operation messages politely', () => {
  setup({
    message: 'This contribution needs review. Do not submit another charge.',
  });
  expect(screen.getByText(/This contribution needs review/)).toHaveProp(
    'accessibilityLiveRegion',
    'polite'
  );
});
