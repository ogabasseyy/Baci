import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import {
  readSavingsCardContributionSnapshot,
  saveSavingsCardContributionSnapshot,
} from '@/lib/savings-card-contribution-snapshot';
import {
  getSavingsCardContributionOptions,
  getSavingsCardContributionStatus,
  submitSavingsCardContribution,
} from '@/lib/savings-card-contributions';
import { SavingsPlanCardContribution } from './SavingsPlanCardContribution';

jest.mock('./use-savings-first-card-checkout', () => ({
  useSavingsFirstCardCheckout: () => ({
    amountKobo: null,
    begin: jest.fn(),
    busy: false,
    canStart: false,
    enabled: mockFirstCardEnabled,
    limitKobo: 0,
    loading: false,
    message: '',
    recoveryBlocked: false,
    refreshStatus: jest.fn(),
    reviewing: false,
    setReviewing: jest.fn(),
    snapshot: null,
    status: null,
    allowRetry: false,
  }),
}));

jest.mock('@/lib/savings-card-contributions', () => ({
  getSavingsCardContributionOptions: jest.fn(),
  getSavingsCardContributionStatus: jest.fn(),
  submitSavingsCardContribution: jest.fn(),
}));
jest.mock('@/lib/savings-card-contribution-snapshot', () => ({
  clearTerminalSavingsCardContributionSnapshot: jest.fn(),
  readSavingsCardContributionSnapshot: jest.fn(),
  saveSavingsCardContributionSnapshot: jest.fn(),
}));

const goalId = '00000000-0000-4000-8000-000000000001';
const methodId = '00000000-0000-4000-8000-000000000002';
const requestKey = '00000000-0000-4000-8000-000000000003';
let mockFirstCardEnabled = false;
const snapshot = {
  idempotencyKey: requestKey,
  goalId,
  savedMethodId: methodId,
  amountKobo: 125050,
  consent: {
    version: 'prefunded-card-v1' as const,
    oneTimeCharge: true as const,
  },
};
const options = {
  goalId,
  enabled: true,
  newCardEnabled: false as const,
  currency: 'NGN' as const,
  maximumAmountKobo: 500000,
  savedMethods: [{ id: methodId, brand: 'Visa', last4: '4242' }],
};

function panel(sourceMode: 'manual' | 'auto_debit' = 'manual') {
  return (
    <SavingsPlanCardContribution
      amount=""
      colors={Colors.dark}
      goalId={goalId}
      merchantId="merchant-scope"
      onAmountChange={jest.fn()}
      remainingAmount={5000}
      sourceMode={sourceMode}
      userId="customer-scope"
    />
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFirstCardEnabled = false;
  jest.mocked(getSavingsCardContributionOptions).mockResolvedValue(options);
  jest.mocked(getSavingsCardContributionStatus).mockResolvedValue({
    operationId: requestKey,
    goalId,
    amountKobo: snapshot.amountKobo,
    currency: 'NGN',
    status: 'pending',
  });
  jest.mocked(readSavingsCardContributionSnapshot).mockResolvedValue(null);
  jest.mocked(saveSavingsCardContributionSnapshot).mockResolvedValue(snapshot);
});

it('keeps manual card contribution collapsed and exposes saved cards without new-card setup', async () => {
  render(panel());
  await act(async () => {});
  expect(screen.queryByLabelText('Card contribution amount')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Pay by card' }));
  expect(await screen.findByRole('radio')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Add a card' })).toBeNull();
  expect(screen.getByLabelText('Card contribution amount')).toBeOnTheScreen();
});

it('does not render an unusable saved-card form when the capability is disabled', async () => {
  jest.mocked(getSavingsCardContributionOptions).mockResolvedValue({
    ...options,
    enabled: false,
    savedMethods: [],
  });
  render(panel());
  await act(async () => {});
  expect(screen.queryByRole('button', { name: 'Pay by card' })).toBeNull();
  expect(screen.queryByLabelText('Card contribution amount')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Add a card' })).toBeNull();
  expect(submitSavingsCardContribution).not.toHaveBeenCalled();
});

it('renders only the enabled new-card form when the saved-card endpoint is unavailable', async () => {
  mockFirstCardEnabled = true;
  jest
    .mocked(getSavingsCardContributionOptions)
    .mockRejectedValue(new Error('404'));
  render(panel('auto_debit'));
  await act(async () => {});

  expect(
    screen.getByLabelText('New card contribution amount')
  ).toBeOnTheScreen();
  expect(screen.queryByLabelText('Card contribution amount')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Pay by card' })).toBeNull();
  expect(screen.queryByText(/Card contributions are/)).toBeNull();
  expect(submitSavingsCardContribution).not.toHaveBeenCalled();
});

it('keeps pending saved-card recovery visible when its capability is disabled', async () => {
  jest.mocked(readSavingsCardContributionSnapshot).mockResolvedValue(snapshot);
  jest
    .mocked(getSavingsCardContributionOptions)
    .mockRejectedValue(new Error('404'));
  render(panel('auto_debit'));
  await act(async () => {});

  expect(
    screen.getByRole('button', { name: 'Check card contribution status' })
  ).toBeOnTheScreen();
  expect(screen.getByLabelText('Card contribution amount')).toBeDisabled();
  expect(submitSavingsCardContribution).not.toHaveBeenCalled();
});

it('restores an uncertain pending request by status lookup only', async () => {
  jest.mocked(readSavingsCardContributionSnapshot).mockResolvedValue(snapshot);
  const view = render(panel('auto_debit'));
  await act(async () => {});
  expect(getSavingsCardContributionStatus).toHaveBeenCalledWith(
    expect.objectContaining({ goalId, idempotencyKey: requestKey })
  );
  expect(submitSavingsCardContribution).not.toHaveBeenCalled();
  expect(
    screen.getByText(/regular auto-debit schedule stays unchanged/)
  ).toBeOnTheScreen();
  view.unmount();
});

it('confirms the displayed one-time amount and retries with the durable same-key payload', async () => {
  const onAmountChange = jest.fn();
  const view = render(
    <SavingsPlanCardContribution
      amount="1250.50"
      colors={Colors.light}
      goalId={goalId}
      merchantId="merchant-scope"
      onAmountChange={onAmountChange}
      remainingAmount={5000}
      sourceMode="manual"
      userId="customer-scope"
    />
  );
  await act(async () => {});
  fireEvent.press(screen.getByRole('button', { name: 'Pay by card' }));
  fireEvent.press(await screen.findByRole('radio'));
  fireEvent.press(
    screen.getByRole('button', { name: 'Review card contribution' })
  );
  expect(screen.getByText(/one-time charge of ₦1,250.50/)).toBeOnTheScreen();
  expect(submitSavingsCardContribution).not.toHaveBeenCalled();
  jest
    .mocked(submitSavingsCardContribution)
    .mockRejectedValueOnce(new Error('503'));
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: /Confirm one-time charge/ })
    );
  });
  expect(saveSavingsCardContributionSnapshot).toHaveBeenCalledWith(
    { userId: 'customer-scope', merchantId: 'merchant-scope', goalId },
    expect.objectContaining({ amountKobo: 125050, savedMethodId: methodId })
  );
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', {
        name: 'Retry same card contribution request',
      })
    );
  });
  expect(submitSavingsCardContribution).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ request: snapshot })
  );
  expect(getSavingsCardContributionStatus).toHaveBeenCalledWith(
    expect.objectContaining({ idempotencyKey: requestKey })
  );
  view.unmount();
});

it('keeps the saved request when the status endpoint reports an unavailable uncertainty', async () => {
  jest.mocked(readSavingsCardContributionSnapshot).mockResolvedValue(snapshot);
  jest
    .mocked(getSavingsCardContributionStatus)
    .mockRejectedValue(new Error('503'));
  render(panel('auto_debit'));
  await act(async () => {});
  expect(
    screen.getByRole('button', { name: 'Retry same card contribution request' })
  ).toBeOnTheScreen();
  expect(submitSavingsCardContribution).not.toHaveBeenCalled();
});
