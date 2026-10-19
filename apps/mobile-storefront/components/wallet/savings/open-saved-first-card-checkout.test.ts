import { openSavingsFirstCardBrowser } from '@/lib/savings-first-card-browser';
import { openSavedFirstCardCheckout } from './open-saved-first-card-checkout';

jest.mock('@/lib/savings-first-card-browser', () => ({
  openSavingsFirstCardBrowser: jest.fn(),
}));

const snapshot = {
  goalId: '00000000-0000-4000-8000-000000000001',
  amountKobo: 12500,
  idempotencyKey: '00000000-0000-4000-8000-000000000002',
  consent: {
    version: 'prefunded-first-card-v1' as const,
    oneTimeCharge: true as const,
    saveCard: true as const,
  },
  intentId: '00000000-0000-4000-8000-000000000003',
  status: 'ready' as const,
  authorizationUrl: 'https://checkout.paystack.com/access123',
};
const scope = {
  userId: 'user',
  merchantId: 'merchant',
  goalId: snapshot.goalId,
};

beforeEach(() => jest.clearAllMocks());

it('refreshes only after the browser closes while the original scope remains current', async () => {
  const isCurrent = jest.fn(() => true);
  const onClosed = jest.fn(async () => undefined);
  await openSavedFirstCardCheckout({
    activation: 1,
    isCurrent,
    onClosed,
    onUnavailable: jest.fn(),
    requestScope: scope,
    requestScopeKey: 'scope',
    snapshot,
  });
  expect(openSavingsFirstCardBrowser).toHaveBeenCalledWith(
    snapshot.authorizationUrl
  );
  expect(onClosed).toHaveBeenCalledWith(snapshot, 'scope', 1, scope);
});

it('never opens or refreshes an old checkout after a scope switch', async () => {
  const onClosed = jest.fn(async () => undefined);
  await openSavedFirstCardCheckout({
    activation: 1,
    isCurrent: () => false,
    onClosed,
    onUnavailable: jest.fn(),
    requestScope: scope,
    requestScopeKey: 'old-scope',
    snapshot,
  });
  expect(openSavingsFirstCardBrowser).not.toHaveBeenCalled();
  expect(onClosed).not.toHaveBeenCalled();
});
