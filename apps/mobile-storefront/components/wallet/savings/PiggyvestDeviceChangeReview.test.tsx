import { piggyvestDeviceChangeSchemas as schemas } from '@baci/shared/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { PiggyvestDeviceChangeReview } from './PiggyvestDeviceChangeReview';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
const goalId = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const published = () =>
  schemas.published.parse({
    status: 'quote_available',
    quote: {
      goalId,
      quoteId: revisionId,
      revisionId,
      priorRevisionId: goalId,
      device: {
        productId: goalId,
        variantId: revisionId,
        productName: 'Synthetic phone',
        variant: '512GB',
        condition: 'New',
      },
      priceKobo: 500050,
      durationMonths: 3,
      termsVersion: 'synthetic',
      termsHash: 'a'.repeat(64),
      maturesAt: '2099-01-01T00:00:00Z',
      graceExpiresAt: null,
      expiresAt: '2098-01-01T00:00:00Z',
    },
    terms: {
      version: 'synthetic',
      hash: 'a'.repeat(64),
      text: 'Exact synthetic terms',
    },
  });

it('displays the exact new variant, price and duration; submits exact consent once', async () => {
  const quote = published();
  const command = schemas.confirmation.parse({
    goalId,
    operationId: goalId,
    accepted: true,
    quote: quote.quote,
  });
  const confirm = jest.fn(async () => undefined);
  render(
    <PiggyvestDeviceChangeReview
      published={quote}
      command={command}
      contextKey="session"
      disabled={false}
      onConfirm={confirm}
    />
  );
  expect(screen.getByText('Synthetic phone — 512GB — New')).toBeOnTheScreen();
  expect(screen.getByText(/₦5,000.50/)).toBeOnTheScreen();
  expect(screen.getByText('Duration: 3 months')).toBeOnTheScreen();
  expect(
    screen.getByRole('button', { name: 'Confirm device change' })
  ).toBeDisabled();
  fireEvent.press(screen.getByRole('checkbox'));
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Confirm device change' })
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Confirm device change' })
    );
  });
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(confirm).toHaveBeenCalledWith(command);
});

it('never defaults missing duration or unlocks an uncertain operation on callback replacement', async () => {
  const quote = published();
  quote.quote.durationMonths = null;
  const command = schemas.confirmation.parse({
    goalId,
    operationId: goalId,
    accepted: true,
    quote: quote.quote,
  });
  const props = {
    published: quote,
    command,
    contextKey: 'session',
    disabled: false,
  };
  const view = render(
    <PiggyvestDeviceChangeReview
      {...props}
      onConfirm={async () => {
        throw new Error('private');
      }}
    />
  );
  expect(screen.getByText('Duration: unavailable')).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('checkbox'));
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Confirm device change' })
    );
  });
  view.rerender(
    <PiggyvestDeviceChangeReview {...props} onConfirm={async () => undefined} />
  );
  expect(
    screen.getByRole('button', { name: 'Confirm device change' })
  ).toBeDisabled();
  expect(screen.getByText(/Do not resubmit/)).toBeOnTheScreen();
});
