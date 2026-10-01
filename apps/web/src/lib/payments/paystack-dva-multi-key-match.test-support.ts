import type {
  DvaMatchCandidate,
  DvaMatchContext,
} from '@/lib/payments/paystack-dva-multi-key-match';

export const ctx = (
  overrides: Partial<DvaMatchContext> = {}
): DvaMatchContext => ({
  verifiedAmountKobo: 83_500_000,
  customerEmail: 'customer@example.com',
  paidAt: new Date('2026-05-09T11:03:00Z'),
  ...overrides,
});

export const candidate = (
  overrides: Partial<DvaMatchCandidate> = {}
): DvaMatchCandidate => ({
  order_id: '211bcf0e-0795-488f-aeeb-52c5b7a8b9ae',
  merchant_id: 'merchant-1',
  customer_email: 'customer@example.com',
  total_kobo: 83_500_000,
  account_created_at: new Date('2026-05-09T10:00:00Z'),
  account_expires_at: new Date('2026-05-09T11:30:00Z'),
  ...overrides,
});
