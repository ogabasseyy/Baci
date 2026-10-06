import { piggyvestProtectedOfferSchemas as schemas } from '@baci/shared/contracts';
import { render, screen } from '@testing-library/react-native';
import { PiggyvestProtectedOffer } from './PiggyvestProtectedOffer';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
const id = '11111111-1111-4111-8111-111111111111';
const observation = (pricePromise: 'active' | 'expired' | 'historical') =>
  schemas.observation.parse({
    status: 'observed',
    requestedOfferId: id,
    observedAt: '2026-09-13T12:00:00Z',
    pricePromise,
    funds: 'requires_checkout_review',
    receipt: {
      offerId: id,
      goalId: id,
      revisionId: id,
      device: { productId: id, variantId: id, condition: 'New' },
      priceKobo: 970050,
      termsVersion: 'synthetic',
      termsHash: 'a'.repeat(64),
      startsAt: '2026-09-12T12:00:00Z',
      expiresAt: '2026-09-19T12:00:00Z',
      scope: 'device_price_only',
      purchase: 'requires_confirmation',
      dispatch: 'disabled',
    },
  });

it('displays server-active seven-day price without using device time or accepting an offer', () => {
  const now = jest
    .spyOn(Date, 'now')
    .mockReturnValue(Date.parse('2099-01-01T00:00:00Z'));
  try {
    render(<PiggyvestProtectedOffer observation={observation('active')} />);
    expect(screen.getByText(/Server observed: active/)).toBeOnTheScreen();
    expect(screen.getByText(/₦9,700.50/)).toBeOnTheScreen();
    expect(
      screen.getByText(/Honoured throughout the recorded seven-day window/)
    ).toBeOnTheScreen();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  } finally {
    now.mockRestore();
  }
});

it.each([
  'expired',
  'historical',
] as const)('labels %s server evidence without inventing a new price or cancelling an existing guarantee', (state) => {
  render(<PiggyvestProtectedOffer observation={observation(state)} />);
  expect(
    screen.getByText(new RegExp(`Server observed: ${state}`))
  ).toBeOnTheScreen();
  expect(
    screen.getByText(/does not cancel any still-valid original guarantee/)
  ).toBeOnTheScreen();
  expect(screen.getByText(/Checkout must revalidate funds/)).toBeOnTheScreen();
});

it('fails closed on malformed extra fields rather than rendering an active promise', () => {
  render(
    <PiggyvestProtectedOffer
      observation={{ ...observation('active'), accepted: true }}
    />
  );
  expect(screen.getByText('Protected offer unavailable.')).toBeOnTheScreen();
  expect(screen.queryByText(/Server observed: active/)).toBeNull();
});
