import { beforeEach, expect, it, vi } from 'vitest';
import { decryptAndValidateReceipt } from './replay-crypto';
import { createPaidInterestTestFixture } from './replay-paid-interest.test-support';

const mocks = vi.hoisted(() => ({
  readiness: vi.fn(),
  executor: vi.fn(),
  interest: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock('./replay-financial-readiness', () => ({
  checkFinancialReplayReadiness: mocks.readiness,
}));
vi.mock('./replay-financial-postgres', () => ({
  createFinancialReplayPostgres: mocks.executor,
}));
vi.mock('./replay-interest-runtime', () => ({
  createInterestReplay: mocks.interest,
}));

import { createPaidInterestReplay } from './replay-paid-interest-runtime';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readiness.mockResolvedValue('ready');
  mocks.executor.mockReturnValue(vi.fn());
  mocks.interest.mockReturnValue(mocks.dispatch);
  mocks.dispatch.mockResolvedValue('duplicate');
});

it('constructs only the existing paid-interest callback after actual readiness succeeds', async () => {
  const sample = createPaidInterestTestFixture();
  const dispatch = await createPaidInterestReplay({
    database: sample.configuration.paidInterestDatabase,
    expectedAppSystemId: sample.configuration.appSystemId,
  });
  expect(mocks.readiness).toHaveBeenCalledExactlyOnceWith(
    sample.configuration.paidInterestDatabase,
    sample.configuration.appSystemId
  );
  expect(mocks.interest).toHaveBeenCalledExactlyOnceWith(
    {
      integrationId: sample.scope.integrationId,
      businessId: sample.scope.businessId,
      expectedSystemId: sample.scope.expectedSystemId,
    },
    mocks.executor.mock.results[0].value
  );
  const row = sample.rows[2];
  const event = decryptAndValidateReceipt(
    {
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      authTag: row.auth_tag,
      payloadSha256: row.payload_sha256,
      keyVersion: 'staging-v1',
    },
    sample.key,
    null
  ).event;
  await expect(
    dispatch({
      event,
      lease: {
        receiptId: row.receipt_id,
        claimToken: row.claim_token,
        eventId: null,
        sealed: {
          ciphertext: row.ciphertext,
          nonce: row.nonce,
          authTag: row.auth_tag,
          payloadSha256: row.payload_sha256,
          keyVersion: 'staging-v1',
        },
      },
    })
  ).resolves.toBe('duplicate');
  expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith(event);
});

it('never sends a bank event into the paid-interest adapter', async () => {
  const sample = createPaidInterestTestFixture();
  const dispatch = await createPaidInterestReplay({
    database: sample.configuration.paidInterestDatabase,
    expectedAppSystemId: sample.configuration.appSystemId,
  });
  const row = sample.rows[0];
  const sealed = {
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    authTag: row.auth_tag,
    payloadSha256: row.payload_sha256,
    keyVersion: 'staging-v1' as const,
  };
  const event = decryptAndValidateReceipt(sealed, sample.key, null).event;
  expect(() =>
    dispatch({
      event,
      lease: {
        receiptId: row.receipt_id,
        claimToken: row.claim_token,
        eventId: null,
        sealed,
      },
    })
  ).toThrow('Financial replay deferred');
  expect(mocks.dispatch).not.toHaveBeenCalled();
});

it.each([
  'transport-unavailable',
  'authority-unavailable',
])('refuses %s before constructing an executor', async (status) => {
  const sample = createPaidInterestTestFixture();
  mocks.readiness.mockResolvedValue(status);
  await expect(
    createPaidInterestReplay({
      database: sample.configuration.paidInterestDatabase,
      expectedAppSystemId: sample.configuration.appSystemId,
    })
  ).rejects.toThrow('Staging paid interest unavailable');
  expect(mocks.executor).not.toHaveBeenCalled();
  expect(mocks.interest).not.toHaveBeenCalled();
});

it('refuses another physical database before any readiness connection', async () => {
  const sample = createPaidInterestTestFixture();
  await expect(
    createPaidInterestReplay({
      database: sample.configuration.paidInterestDatabase,
      expectedAppSystemId: '1',
    })
  ).rejects.toThrow('Staging paid interest unavailable');
  expect(mocks.readiness).not.toHaveBeenCalled();
  expect(mocks.executor).not.toHaveBeenCalled();
});
