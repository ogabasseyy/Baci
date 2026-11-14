import { screen } from '@testing-library/react-native';

/**
 * Shared fixtures for the storefront release gate's server-off tests: the
 * server keeping PiggyVest off is seen as a not-ready answer, a negative
 * capability verdict, no verdict at all, or a failed probe. In every case the
 * app must behave like the production build that predates PiggyVest.
 */
// A merchant outside the PiggyVest pilot.
export const SERVER_OFF_MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
export const SERVER_OFF_GOAL_ID = '22222222-2222-4222-8222-222222222222';
export const SERVER_OFF_OPERATION_ID = '33333333-3333-4333-8333-333333333333';
export const SERVER_OFF_ACCOUNT_NUMBER = '0000008907';
export const PRIMARY_STATUS_PATH =
  '/api/storefront/customer/savings/primary-provisioning';
export const PRIMARY_TRANSFER_PATH =
  '/api/storefront/customer/savings/primary-transfer';

/** The error the API client throws when the server answers "not configured". */
export function serverOffError(code = 'PIGGYVEST_NOT_READY') {
  return Object.assign(new Error('not ready'), { code });
}

/** Asserts no verdict-gated plan status UI or account number is on screen. */
export function expectNoPiggyvestUi() {
  expect(screen.queryByText(SERVER_OFF_ACCOUNT_NUMBER)).toBeNull();
  expect(screen.queryByText(/still being set up/)).toBeNull();
  expect(screen.queryByText(/Setup is not available/)).toBeNull();
  expect(screen.queryByText(/check this goal/)).toBeNull();
  expect(screen.queryByText(/Earn interest on this goal/)).toBeNull();
  expect(screen.queryByText('Set up this goal')).toBeNull();
  expect(screen.queryByText('Try setup again')).toBeNull();
  expect(screen.queryByText(/\d{10}/)).toBeNull();
}
