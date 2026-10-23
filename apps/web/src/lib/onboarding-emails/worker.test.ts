import { describe, expect, it, vi } from 'vitest';
import type { JourneyContext } from '@/schemas/merchant-onboarding-email';
import { type JourneyRepository, processOnboardingEmailBatch } from './worker';

const job = {
  id: 'j1',
  merchant_id: 'm1',
  stage: 'welcome' as const,
  claim_token: 'c1',
};
const context: JourneyContext = {
  merchant_id: 'm1',
  email: 'owner@example.com',
  business_name: 'A store',
  confirmed: true,
  enabled: true,
  reply_to: 'help@usebaci.com',
  opt_out_token: 'token',
  is_published: false,
  provisioned: true,
  slug: 'store',
  country: 'GB',
  payout_currency: 'GBP',
  has_contact: true,
  bank_configured: false,
  paystack_configured: false,
  feature_settings: {
    paystack_enabled: false,
    korapay_enabled: false,
    pay_on_delivery_enabled: true,
  },
  identity_verified: false,
  active_product_count: 0,
};
function fixture() {
  const repo: JourneyRepository = {
    claim: vi.fn().mockResolvedValue([job]),
    context: vi.fn().mockResolvedValue(context),
    beginDispatch: vi.fn().mockResolvedValue(true),
    finish: vi.fn().mockResolvedValue(undefined),
  };
  const send = vi.fn().mockImplementation(async (input) => {
    await input.beforeTransportDispatch();
    return { success: true, messageId: 'provider1' };
  });
  return { repo, send };
}
describe('onboarding email worker', () => {
  it('audits platform mail with a durable claim before dispatch', async () => {
    const { repo, send } = fixture();
    expect(
      await processOnboardingEmailBatch(
        repo,
        send,
        'https://project.supabase.co'
      )
    ).toEqual({ processed: 1, accepted: 1, unknown: 0, failed: 0 });
    expect(repo.beginDispatch).toHaveBeenCalledOnce();
    expect(repo.finish).toHaveBeenCalledWith(
      job,
      'accepted',
      'provider_accepted',
      'provider1'
    );
    expect(send.mock.calls[0][0]).toMatchObject({
      emailType: 'welcome',
      maxAttemptsPerSender: 1,
      replyTo: 'help@usebaci.com',
    });
  });
  it('does not send to a deleted or reassigned merchant', async () => {
    const { repo, send } = fixture();
    vi.mocked(repo.context).mockResolvedValue(null);
    await processOnboardingEmailBatch(
      repo,
      send,
      'https://project.supabase.co'
    );
    expect(send).not.toHaveBeenCalled();
    expect(repo.finish).toHaveBeenCalledWith(job, 'skipped', 'ineligible');
  });
  it('blocks opt-out that arrives between selection and dispatch', async () => {
    const { repo, send } = fixture();
    vi.mocked(repo.context)
      .mockResolvedValueOnce(context)
      .mockResolvedValue({ ...context, enabled: false });
    await processOnboardingEmailBatch(
      repo,
      send,
      'https://project.supabase.co'
    );
    expect(repo.beginDispatch).not.toHaveBeenCalled();
    expect(repo.finish).toHaveBeenCalledWith(job, 'skipped', 'state_changed');
  });
  it('does not dispatch if a concurrent worker won the claim', async () => {
    const { repo, send } = fixture();
    vi.mocked(repo.beginDispatch).mockResolvedValue(false);
    await processOnboardingEmailBatch(
      repo,
      send,
      'https://project.supabase.co'
    );
    expect(repo.finish).toHaveBeenCalledWith(
      job,
      'pending',
      'dispatch_not_admitted'
    );
  });
  it('never automatically retries an ambiguous provider result', async () => {
    const { repo, send } = fixture();
    send.mockImplementation(async (input) => {
      await input.beforeTransportDispatch();
      throw Error('timeout');
    });
    expect(
      await processOnboardingEmailBatch(
        repo,
        send,
        'https://project.supabase.co'
      )
    ).toMatchObject({ unknown: 1 });
    expect(repo.finish).toHaveBeenCalledWith(
      job,
      'unknown',
      'reconcile_provider_outcome'
    );
    expect(send).toHaveBeenCalledOnce();
  });
  it('defers unconfirmed owners without beginning transport', async () => {
    const { repo, send } = fixture();
    vi.mocked(repo.context).mockResolvedValue({ ...context, confirmed: false });
    await processOnboardingEmailBatch(
      repo,
      send,
      'https://project.supabase.co'
    );
    expect(send).not.toHaveBeenCalled();
    expect(repo.finish).toHaveBeenCalledWith(
      job,
      'pending',
      'waiting_for_setup'
    );
  });
  it('rejects changed owner email at the final eligibility check', async () => {
    const { repo, send } = fixture();
    vi.mocked(repo.context)
      .mockResolvedValueOnce(context)
      .mockResolvedValue({ ...context, email: 'changed@example.com' });
    await processOnboardingEmailBatch(
      repo,
      send,
      'https://project.supabase.co'
    );
    expect(repo.beginDispatch).not.toHaveBeenCalled();
  });
});

it('reports pre-dispatch configuration errors so the scheduler can alert', async () => {
  const { repo, send } = fixture();
  vi.mocked(repo.context).mockResolvedValue({ ...context, reply_to: null });
  expect(
    await processOnboardingEmailBatch(repo, send, 'https://project.supabase.co')
  ).toMatchObject({ failed: 1 });
  expect(send).not.toHaveBeenCalled();
});

it('hosts the opt-out confirmation on Baci rather than the default Supabase domain', async () => {
  const { repo, send } = fixture();
  await processOnboardingEmailBatch(repo, send, 'https://usebaci.com');
  expect(send.mock.calls[0][0].textContent).toContain(
    'https://usebaci.com/onboarding/email-preferences?token=token'
  );
  expect(send.mock.calls[0][0].textContent).not.toContain('/functions/v1/');
});
