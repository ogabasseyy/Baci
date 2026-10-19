import { expect, it, vi } from 'vitest';
import { createPrimaryWalletSavingsStore } from './primary-wallet-savings-store';

vi.mock('server-only', () => ({}));
const scope = {
  merchantId: '00000000-0000-4000-8000-000000000001',
  customerId: '00000000-0000-4000-8000-000000000002',
  userId: '00000000-0000-4000-8000-000000000003',
  integrationId: '00000000-0000-4000-8000-000000000004',
  businessId: 'business',
  environment: 'staging',
};
const operationId = '00000000-0000-4000-8000-000000000005';
it('recovers an outstanding operation using only the authenticated scope and selected goal', async () => {
  const operation = {
    operationId,
    goalId: operationId,
    amountKobo: 500,
    state: 'dispatched',
  };
  const execute = vi.fn().mockResolvedValue({ rows: [{ result: operation }] });
  expect(
    await createPrimaryWalletSavingsStore({ scope, execute }).recoverPending(
      operationId
    )
  ).toEqual(operation);
  expect(execute).toHaveBeenCalledWith(
    'SELECT piggyvest_primary.read_pending_savings($1::jsonb,$2::uuid) AS result',
    [JSON.stringify(scope), operationId]
  );
});
it('rejects malformed recovered operations instead of permitting a second payment', async () => {
  const execute = vi
    .fn()
    .mockResolvedValue({ rows: [{ result: { operationId, amountKobo: -1 } }] });
  await expect(
    createPrimaryWalletSavingsStore({ scope, execute }).recoverPending(
      operationId
    )
  ).rejects.toThrow();
});
it('uses fixed dispatch SQL with the independently bound customer scope', async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [{ result: true }] });
  expect(
    await createPrimaryWalletSavingsStore({ scope, execute }).claimDispatch(
      operationId
    )
  ).toBe(true);
  expect(execute).toHaveBeenCalledWith(
    'SELECT piggyvest_primary.manage_savings($1::jsonb,$2::uuid,$3::text) AS result',
    [JSON.stringify(scope), operationId, 'dispatch']
  );
});
it('does not claim released funds when cancellation is refused', async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [{ result: false }] });
  await expect(
    createPrimaryWalletSavingsStore({ scope, execute }).cancelBeforeDispatch(
      operationId
    )
  ).rejects.toThrow('could not be released');
});
it('cancels only stale reservations from status checks', async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [{ result: false }] });
  await expect(
    createPrimaryWalletSavingsStore({ scope, execute }).cancelStaleReservation(
      operationId
    )
  ).resolves.toBe(false);
  expect(execute).toHaveBeenCalledWith(
    'SELECT piggyvest_primary.manage_savings($1::jsonb,$2::uuid,$3::text) AS result',
    [JSON.stringify(scope), operationId, 'cancel_stale']
  );
});
it('releases dispatched holds with fixed SQL after definitive rejection', async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [{ result: true }] });
  await expect(
    createPrimaryWalletSavingsStore({ scope, execute }).releaseAfterRejection(
      operationId
    )
  ).resolves.toBe(true);
  expect(execute).toHaveBeenCalledWith(
    'SELECT piggyvest_primary.manage_savings($1::jsonb,$2::uuid,$3::text) AS result',
    [JSON.stringify(scope), operationId, 'release']
  );
});
it('rejects injected wallet IDs before storage contact', async () => {
  const execute = vi.fn();
  await expect(
    createPrimaryWalletSavingsStore({ scope, execute }).reserve({
      goalId: operationId,
      operationId,
      amountKobo: 100,
      sourceWalletId: 'foreign',
    })
  ).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});
it('rejects malformed database acknowledgements', async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [{ result: 'true' }] });
  await expect(
    createPrimaryWalletSavingsStore({ scope, execute }).claimDispatch(
      operationId
    )
  ).rejects.toThrow();
});
it('adopts pending operations through fixed adoption SQL with a parsed reservation', async () => {
  const reservation = {
    operationId,
    goalId: operationId,
    amountKobo: 500,
    sourceWalletId: 'source',
    destinationWalletId: 'destination',
    reference: 'stable-reference',
    businessId: 'business',
    providerCustomerId: 'source-customer',
  };
  const execute = vi
    .fn()
    .mockResolvedValueOnce({
      rows: [{ result: { status: 'reclaimed', reservation } }],
    })
    .mockResolvedValueOnce({ rows: [{ result: { status: 'existing' } }] });
  const store = createPrimaryWalletSavingsStore({ scope, execute });
  expect(await store.adoptPending(operationId)).toEqual({
    status: 'reclaimed',
    reservation,
  });
  expect(await store.adoptPending(operationId)).toEqual({
    status: 'existing',
  });
  expect(execute).toHaveBeenCalledWith(
    'SELECT piggyvest_primary.adopt_pending_savings($1::jsonb,$2::uuid) AS result',
    [JSON.stringify(scope), operationId]
  );
});
