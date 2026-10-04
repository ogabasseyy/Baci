import { expect, it, vi } from 'vitest';
import { createPiggyvestDraftClosureController } from './piggyvest-draft-closure-controller';

const goalId = 'abcdefab-0000-4000-8000-000000000816';
const available = {
  status: 'available',
  goalId,
  revisionId: goalId,
  termsVersion: 'synthetic',
  termsHash: 'a'.repeat(64),
  action: 'close_plan',
};
const source = {
  environment: 'staging',
  status: 'ready',
  sessionKey: 'session',
  goalId,
  policy: {
    status: 'draft',
    goalId,
    revisionId: goalId,
    device: { productName: 'Synthetic', variant: null, condition: 'New' },
    terms: { version: 'synthetic', hash: 'a'.repeat(64), text: 'Plain terms' },
    consent: 'accepted',
  },
  eligibility: { status: 'blocked' },
  funding: { status: 'unavailable' },
  progress: { status: 'unavailable' },
};
function fixture() {
  const receipt = {
    ...available,
    status: 'closed',
    operationId: goalId,
    closedAt: '2026-09-12T00:00:00Z',
    refundIssued: false,
    providerWalletDeleted: false,
  };
  const read = vi.fn<() => Promise<unknown>>().mockResolvedValue(available);
  const close = vi.fn<() => Promise<unknown>>().mockResolvedValue(receipt);
  const options = {
    source,
    tenantKey: 'tenant',
    operationId: goalId,
    read,
    close,
    isCurrent: vi.fn(() => true),
  };
  return {
    options,
    read,
    close,
    receipt,
    controller: createPiggyvestDraftClosureController(options),
  };
}
it('requires current review consent, gates double clicks, and isolates observer exceptions', async () => {
  const data = fixture();
  data.controller.subscribe(() => {
    throw new Error();
  });
  await data.controller.refresh();
  const version = data.controller.read(source)?.reviewVersion;
  await expect(data.controller.close(false, version)).rejects.toThrow();
  const first = data.controller.close(true, version);
  await expect(data.controller.close(true, version)).rejects.toThrow();
  await first;
  expect(data.close).toHaveBeenCalledTimes(1);
  expect(data.controller.getFundingBlocked()).toBe(true);
});
it('lost response stays uncertain even if readback says available; only exact closed receipt resolves', async () => {
  const data = fixture();
  await data.controller.refresh();
  data.close.mockRejectedValueOnce(new Error('Private'));
  await expect(
    data.controller.close(true, data.controller.read(source)?.reviewVersion)
  ).rejects.toThrow();
  await data.controller.refresh();
  expect(data.controller.read(source)?.status).toBe('uncertain');
  await expect(
    data.controller.close(true, data.controller.read(source)?.reviewVersion)
  ).rejects.toThrow();
  data.read.mockResolvedValue(data.receipt);
  await data.controller.refresh();
  expect(data.controller.read(source)?.status).toBe('closed');
});
it('mapped goals never close; stale review and A-null-A callbacks cannot submit', async () => {
  const data = fixture();
  await data.controller.refresh();
  const version = data.controller.read(source)?.reviewVersion;
  await data.controller.refresh();
  await expect(data.controller.close(true, version)).rejects.toThrow();
  data.read.mockResolvedValue({
    status: 'requires_reconciliation',
    goalId,
    reason: 'provider_zero_unverified',
  });
  await data.controller.refresh();
  await expect(
    data.controller.close(true, data.controller.read(source)?.reviewVersion)
  ).rejects.toThrow();
  expect(data.close).not.toHaveBeenCalled();
  expect(data.controller.read(null)).toBeNull();
  expect(data.controller.read(source)).toBeNull();
});

it('rejects false acknowledgement and wrong-operation recovery without reopening close', async () => {
  const data = fixture();
  await data.controller.refresh();
  data.close.mockResolvedValue({
    ...data.receipt,
    operationId: 'dddddddd-0000-4000-8000-000000000816',
  });
  await expect(
    data.controller.close(true, data.controller.read(source)?.reviewVersion)
  ).rejects.toThrow();
  data.read.mockResolvedValue({ ...data.receipt, refundIssued: true });
  await expect(data.controller.refresh()).rejects.toThrow();
  expect(data.controller.read(source)?.status).toBe('uncertain');
  expect(data.controller.getFundingBlocked()).toBe(true);
});

it('readback on restart never treats available as safe to replay an uncertain command', async () => {
  const data = fixture();
  const recovered = createPiggyvestDraftClosureController({
    ...data.options,
    recovery: true,
  });
  await recovered.refresh();
  expect(recovered.read(source)?.status).toBe('uncertain');
  await expect(
    recovered.close(true, recovered.read(source)?.reviewVersion)
  ).rejects.toThrow();
  expect(data.close).not.toHaveBeenCalled();
});

it('sibling busy only blocks dispatch, not current review identity', async () => {
  const data = fixture();
  await data.controller.refresh();
  let compatible = false;
  data.controller.setCompatibilityGuard(() => compatible);
  expect(data.controller.read(source)?.status).toBe('review');
  await expect(
    data.controller.close(true, data.controller.read(source)?.reviewVersion)
  ).rejects.toThrow();
  expect(data.controller.getFundingBlocked()).toBe(false);
  compatible = true;
  await data.controller.close(
    true,
    data.controller.read(source)?.reviewVersion
  );
  expect(data.controller.read(source)?.status).toBe('closed');
});
