import { expect, it, vi } from 'vitest';
import { createJourneyRepository } from './repository';

const id = '12345678-1234-4123-8123-123456789abc';
const job = { id, merchant_id: id, stage: 'welcome' as const, claim_token: id };
function fixture() {
  const rpc = vi.fn();
  const builder = {
    update: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    select: vi.fn(),
  };
  builder.update.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.select.mockResolvedValue({ data: [{ id }], error: null });
  const from = vi.fn().mockReturnValue(builder);
  const client = { rpc, from } as unknown as Parameters<
    typeof createJourneyRepository
  >[0];
  return { repo: createJourneyRepository(client), rpc, from, builder };
}
it('claims a bounded batch and validates database stages', async () => {
  const { repo, rpc } = fixture();
  rpc.mockResolvedValue({ data: [job], error: null });
  expect(await repo.claim()).toEqual([job]);
  expect(rpc).toHaveBeenCalledWith('claim_merchant_onboarding_email_jobs', {
    p_limit: 20,
  });
  rpc.mockResolvedValue({ data: [{ ...job, stage: 'unknown' }], error: null });
  await expect(repo.claim()).rejects.toThrow();
});
it('fails closed when eligibility or dispatch RPCs fail', async () => {
  const { repo, rpc } = fixture();
  rpc.mockResolvedValue({
    data: null,
    error: { message: 'private database details' },
  });
  await expect(repo.context(id)).rejects.toThrow(
    'Could not read onboarding context'
  );
  await expect(repo.beginDispatch(job, 'owner@example.com')).rejects.toThrow(
    'Could not begin onboarding dispatch'
  );
});
it('requires the same claim token when recording acceptance and rejects a lost claim', async () => {
  const { repo, builder } = fixture();
  await repo.finish(job, 'accepted', 'provider_accepted', 'provider-id');
  expect(builder.eq).toHaveBeenCalledWith('claim_token', id);
  expect(builder.update).toHaveBeenCalledWith(
    expect.objectContaining({
      status: 'accepted',
      provider_message_id: 'provider-id',
      claim_token: null,
    })
  );
  builder.select.mockResolvedValue({ data: [], error: null });
  await expect(
    repo.finish(job, 'accepted', 'provider_accepted')
  ).rejects.toThrow('Could not record onboarding outcome');
});

it('defers a definite rejection one hour without extending the original stage expiry', async () => {
  const { repo, builder } = fixture();
  const before = Date.now();
  await repo.finish(job, 'pending', 'provider_rejected');
  const update = builder.update.mock.calls[0][0];
  expect(update).toMatchObject({
    status: 'pending',
    outcome_code: 'provider_rejected',
    claim_token: null,
  });
  expect(Date.parse(update.due_at) - before).toBeGreaterThanOrEqual(3600000);
  expect(update).not.toHaveProperty('expires_at');
  expect(builder.eq).toHaveBeenCalledWith('claim_token', job.claim_token);
});
