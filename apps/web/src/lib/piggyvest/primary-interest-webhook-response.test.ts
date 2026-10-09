import { beforeEach, expect, it, vi } from 'vitest';
import { primaryInterestWebhookResponse } from './primary-interest-webhook-response';

const dispatch = vi.hoisted(() => vi.fn());
const intake = vi.hoisted(() => vi.fn());
vi.mock('server-only', () => ({}));
vi.mock('./primary-wallet-paid-interest-dispatch', () => ({
  dispatchPrimaryWalletPaidInterest: dispatch,
}));
vi.mock('./primary-wallet-paid-interest-inbox-intake', () => ({
  dispatchPrimaryWalletPaidInterestInbox: intake,
}));
const input = { rawBody: new Uint8Array([1]), signature: 'fixture' };
function asHttpResponse(
  response: Awaited<ReturnType<typeof primaryInterestWebhookResponse>>
) {
  if (response === null || response === 'disabled')
    throw new Error('Expected an HTTP response');
  return response;
}
beforeEach(() => {
  vi.clearAllMocks();
  intake.mockResolvedValue('disabled');
});

it.each([
  'accepted',
  'duplicate',
  'quarantined',
])('acknowledges durable interest inbox %s without synchronous credit', async (outcome) => {
  intake.mockResolvedValue(outcome);
  const response = asHttpResponse(await primaryInterestWebhookResponse(input));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(
    outcome === 'quarantined'
      ? { received: true, quarantined: true }
      : {
          received: true,
          interestQueued: true,
          duplicate: outcome === 'duplicate',
        }
  );
  expect(intake).toHaveBeenCalledWith(input);
  expect(dispatch).not.toHaveBeenCalled();
});
it.each([
  'invalid_signature',
  'invalid_payload',
])('does not credit rejected interest inbox %s', async (outcome) => {
  intake.mockResolvedValue(outcome);
  expect(
    asHttpResponse(await primaryInterestWebhookResponse(input)).status
  ).toBe(503);
  expect(dispatch).not.toHaveBeenCalled();
});
it('does not acknowledge or synchronously credit when interest queue persistence fails', async () => {
  intake.mockRejectedValue(new Error('private inbox failure'));
  await expect(primaryInterestWebhookResponse(input)).rejects.toThrow(
    'private inbox failure'
  );
  expect(dispatch).not.toHaveBeenCalled();
});

it('signals disabled instead of legacy fallback when both interest paths are unavailable', async () => {
  dispatch.mockResolvedValue('disabled');
  // The dispatcher answers retryable 503: quarantining would ack a
  // verified payout into permanent loss.
  expect(await primaryInterestWebhookResponse(input)).toBe('disabled');
});
it('routes inbox-declined payouts back to the legacy processor', async () => {
  intake.mockResolvedValue('not_handled');
  expect(await primaryInterestWebhookResponse(input)).toBeNull();
  expect(dispatch).not.toHaveBeenCalled();
});
it('routes direct-declined payouts back to the legacy processor', async () => {
  dispatch.mockResolvedValue('not_handled');
  expect(await primaryInterestWebhookResponse(input)).toBeNull();
});
it.each([
  'credited',
  'duplicate',
])('acknowledges durable %s without exposing provider data', async (outcome) => {
  dispatch.mockResolvedValue(outcome);
  const response = asHttpResponse(await primaryInterestWebhookResponse(input));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    received: true,
    duplicate: outcome === 'duplicate',
  });
  expect(response.headers.get('Cache-Control')).toBe('no-store');
});
it.each([
  'conflict',
  'prerequisite',
])('keeps %s retryable instead of acknowledging unrecorded interest', async (outcome) => {
  dispatch.mockResolvedValue(outcome);
  const response = asHttpResponse(await primaryInterestWebhookResponse(input));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    received: false,
    code: 'PIGGYVEST_INTEREST_RECONCILIATION_PENDING',
  });
});
it('propagates unavailable writes to the redacting outer webhook boundary', async () => {
  dispatch.mockRejectedValue(new Error('unavailable'));
  await expect(primaryInterestWebhookResponse(input)).rejects.toThrow(
    'unavailable'
  );
});
