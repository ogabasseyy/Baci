import { describe, expect, it } from 'vitest';
import type { OpsOpenRequest } from '@/schemas/piggyvest/ops-open-request-row';
import { describeRequest } from './describe-request';

const request: OpsOpenRequest = {
  requestId: '3f0e0000-0000-4000-8000-000000000001',
  action: 'treasury_sweep',
  label: 'Move Collection wallet money to the Ogabassey bank account',
  subject:
    'piggyvest_primary.wallet_transfers:0a0e0000-0000-4000-8000-000000000001',
  amountKobo: 123_456_789,
  destination: 'Bank 058 ••••6789 "Ogabassey GTBank"',
  reason: 'Float top-up',
  requestedBy: 'pv_ops_tunde',
  openedAt: new Date('2026-10-31T10:00:00Z'),
  expiresAt: new Date('2026-11-01T10:00:00Z'),
  approvals: 1,
  decidedByYou: false,
  digest: 'ab'.repeat(32),
};

describe('describeRequest', () => {
  it('shows the plain label, naira amount, masked destination and expiry', () => {
    const text = describeRequest(request).join('\n');
    expect(text).toContain(request.label);
    expect(text).toContain('₦1,234,567.89');
    expect(text).toContain('••••6789');
    expect(text).toContain('2026-11-01T10:00:00.000Z');
    expect(text).toContain('Float top-up');
    expect(text).toContain('pv_ops_tunde');
    expect(text).toContain('1 of 2');
  });

  it('never prints database text with terminal escapes', () => {
    const text = describeRequest({
      ...request,
      reason: 'ok\u001b]0;pwned\u0007',
    }).join('\n');
    expect(text).not.toMatch(/\p{Cc}(?<!\n)/u);
  });
});
