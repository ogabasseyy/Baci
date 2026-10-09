import { beforeEach, describe, expect, it, vi } from 'vitest';
import { primaryCardCustodyInboxFixture as fixture } from './primary-wallet-card-custody-inbox.test-fixture';
import { runPrimaryCardCustodyLaunch } from './primary-wallet-card-custody-launch';

const mocks = vi.hoisted(() => ({
  readiness: vi.fn(),
  runWorker: vi.fn(),
  binding: vi.fn(),
}));
vi.mock('./primary-wallet-card-custody-launch-binding', () => ({
  createPrimaryCardCustodyLaunchBinding: mocks.binding,
}));
vi.mock('./primary-wallet-card-custody-signed-runtime', () => ({
  createPrimaryCardCustodySignedRuntime: () => mocks,
}));
const environment = {
  ...fixture.environment,
  PIGGYVEST_PRIMARY_CARD_TRANSFER_PASSWORD: undefined,
  PIGGYVEST_PRIMARY_CARD_INTAKE_PASSWORD: undefined,
  PIGGYVEST_PRIMARY_CARD_SIGNED_BATCH_SIZE: '1',
  PIGGYVEST_PRIMARY_CARD_WORKER_APPROVED: 'true',
  PIGGYVEST_PRIMARY_CARD_CROSSWALK_FILE: '/fixture/binding.json',
  PIGGYVEST_PRIMARY_CARD_CROSSWALK_FILE_SHA256: 'a'.repeat(64),
  PIGGYVEST_PRIMARY_CARD_CROSSWALK_FILE_SIGNATURE: 'b'.repeat(64),
  PIGGYVEST_PRIMARY_CARD_CROSSWALK_DELIVERY_KEY: 'mock'.repeat(8),
};
const input = {
  mode: 'readiness' as const,
  environment,
  readBinding: vi.fn(async () => Buffer.from('{}')),
  fetchImplementation: vi.fn(),
  now: () => fixture.now,
};
beforeEach(() => {
  vi.resetAllMocks();
  input.readBinding.mockResolvedValue(Buffer.from('{}'));
  mocks.binding.mockReturnValue(async () => null);
  mocks.readiness.mockResolvedValue({ ready: true });
  mocks.runWorker.mockResolvedValue({
    claimed: 1,
    receiptsProcessed: 0,
    deferred: 1,
    blocked: 0,
  });
});
describe('signed custody worker launch', () => {
  it('probes storage and binding without claims or provider calls', async () => {
    expect(await runPrimaryCardCustodyLaunch(input)).toMatchObject({
      status: 'storage_and_binding_ready',
      claimsMade: false,
      receiptProofRequired: true,
      reusableBindingReady: false,
      autonomousFundingReady: false,
      crosswalkSelection: 'operation_records_only',
    });
    expect(mocks.runWorker).not.toHaveBeenCalled();
    expect(input.fetchImplementation).not.toHaveBeenCalled();
  });
  it('runs the existing durable runtime, separating deferred receipts from funding completion', async () => {
    expect(
      await runPrimaryCardCustodyLaunch({ ...input, mode: 'once' })
    ).toMatchObject({ claimed: 1, deferred: 1, fundingComplete: false });
    expect(mocks.runWorker).toHaveBeenCalledOnce();
  });
  it.each([
    { PIGGYVEST_PRIMARY_CARD_TRANSFER_PASSWORD: 'forbidden' },
    { PIGGYVEST_PRIMARY_CARD_SIGNED_BATCH_SIZE: '2' },
    { PIGGYVEST_PRIMARY_CARD_WORKER_APPROVED: 'false' },
  ])('refuses unsafe/unapproved profile before claiming %#', async (change) => {
    await expect(
      runPrimaryCardCustodyLaunch({
        ...input,
        environment: { ...environment, ...change },
      })
    ).rejects.toThrow();
    expect(mocks.runWorker).not.toHaveBeenCalled();
  });
  it('drains acknowledged receipts past expiry instead of stranding charged checkouts', async () => {
    expect(
      await runPrimaryCardCustodyLaunch({
        ...input,
        mode: 'once',
        environment: {
          ...environment,
          PIGGYVEST_PRIMARY_CARD_EXPIRES_AT: '2026-01-01T00:00:00Z',
        },
      })
    ).toMatchObject({ claimed: 1, deferred: 1 });
    expect(mocks.runWorker).toHaveBeenCalledOnce();
  });
  it('propagates claim/settlement failure for scheduler retry', async () => {
    mocks.runWorker.mockRejectedValue(new Error('retry'));
    await expect(
      runPrimaryCardCustodyLaunch({ ...input, mode: 'once' })
    ).rejects.toThrow('retry');
  });
  it('refuses missing database authority rather than reporting ready', async () => {
    mocks.readiness.mockResolvedValue({ ready: false });
    await expect(runPrimaryCardCustodyLaunch(input)).rejects.toThrow(
      'database'
    );
  });
});
