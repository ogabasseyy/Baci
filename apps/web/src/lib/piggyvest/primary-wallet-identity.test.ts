import type { SupabaseClient, User } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { resolvePrimaryWalletIdentity } from './primary-wallet-identity';

vi.mock('server-only', () => ({}));

const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const userId = 'f4f01e61-691f-494a-a895-872f17f8e55e';
const customerId = 'e648eb14-928a-427b-9719-b105f6d4b8b4';
function fixture() {
  const row = {
    id: customerId,
    merchant_id: merchantId,
    user_id: userId,
    email: 'customer@example.com',
    first_name: 'Test',
    last_name: 'Customer',
    phone: '08000000000',
  };
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
  const eq = vi.fn();
  const select = vi.fn();
  const from = vi.fn();
  const builder = { select, eq, maybeSingle };
  eq.mockReturnValue(builder);
  select.mockReturnValue(builder);
  from.mockReturnValue(builder);
  return {
    row,
    maybeSingle,
    eq,
    from,
    supabase: { from } as unknown as SupabaseClient,
    user: {
      id: userId,
      email: 'customer@example.com',
      email_confirmed_at: '2026-10-01T00:00:00Z',
    } as User,
  };
}

describe('primary wallet authenticated identity', () => {
  it('resolves only the authenticated user within the selected merchant', async () => {
    const input = fixture();
    await expect(
      resolvePrimaryWalletIdentity({
        ...input,
        merchantId,
        forOnboarding: false,
      })
    ).resolves.toEqual({
      merchantId,
      customerId,
      userId,
      email: 'customer@example.com',
      emailVerified: true,
      name: 'Test Customer',
      phone: '08000000000',
    });
    expect(input.eq).toHaveBeenCalledWith('merchant_id', merchantId);
    expect(input.eq).toHaveBeenCalledWith('user_id', userId);
  });
  it('requires verified auth email before reading a customer', async () => {
    const input = fixture();
    input.user.email_confirmed_at = undefined;
    expect(
      await resolvePrimaryWalletIdentity({
        ...input,
        merchantId,
        forOnboarding: false,
      })
    ).toBeNull();
    expect(input.from).not.toHaveBeenCalled();
  });
  it.each([
    { user_id: null },
    { user_id: customerId },
    { merchant_id: customerId },
    { phone: null },
  ])('does not use mismatched customer identity: %j', async (change) => {
    const input = fixture();
    input.maybeSingle.mockResolvedValue({
      data: { ...input.row, ...change },
      error: null,
    });
    expect(
      await resolvePrimaryWalletIdentity({
        ...input,
        merchantId,
        forOnboarding: false,
      })
    ).toBeNull();
  });
  it('resolves an existing wallet after a confirmed auth email change', async () => {
    // customers.email has no auth sync, so a confirmed email change
    // would otherwise orphan the funding account and strand dispatched
    // contributions: reads, recovery, and submissions to already-bound
    // wallets resolve on immutable IDs alone.
    const input = fixture();
    input.user.email = 'new-address@example.com';
    await expect(
      resolvePrimaryWalletIdentity({
        ...input,
        merchantId,
        forOnboarding: false,
      })
    ).resolves.toMatchObject({
      merchantId,
      customerId,
      userId,
      email: 'new-address@example.com',
      emailVerified: true,
    });
  });
  it('requires the stored-email match only for new provider onboarding', async () => {
    const input = fixture();
    input.user.email = 'new-address@example.com';
    expect(
      await resolvePrimaryWalletIdentity({
        ...input,
        merchantId,
        forOnboarding: true,
      })
    ).toBeNull();
  });
  it('returns a safe failure on database errors', async () => {
    const input = fixture();
    input.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'private details' },
    });
    expect(
      await resolvePrimaryWalletIdentity({
        ...input,
        merchantId,
        forOnboarding: false,
      })
    ).toBeNull();
  });
});
