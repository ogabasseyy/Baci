import { describe, expect, it } from 'vitest';
import type { OpsOpenRequest } from '@/schemas/piggyvest/ops-approvals';
import {
  describeRequest,
  formatNaira,
  parseNairaInput,
  refusalMessage,
  sanitizeForTerminal,
} from './approve-format';

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

describe('formatNaira', () => {
  it.each([
    [0, '₦0.00'],
    [5, '₦0.05'],
    [1_500_000, '₦15,000.00'],
    [123_456_789, '₦1,234,567.89'],
  ])('formats %i kobo as %s', (kobo, text) => {
    expect(formatNaira(kobo)).toBe(text);
  });
});

describe('parseNairaInput', () => {
  it.each([
    ['1234567.89', 123_456_789],
    ['1,234,567.89', 123_456_789],
    ['₦1,234,567.89', 123_456_789],
    [' 15000 ', 1_500_000],
    ['15000.5', 1_500_050],
    ['0.05', 5],
  ])('reads %s as %i kobo', (text, kobo) => {
    expect(parseNairaInput(text)).toBe(kobo);
  });

  it.each([
    '',
    '-15000',
    '15000.001',
    '15,00.00',
    '1e5',
    '15000 naira',
    '９９',
    '99999999999999999999',
  ])('refuses %j', (text) => {
    expect(parseNairaInput(text)).toBeNull();
  });
});

describe('sanitizeForTerminal', () => {
  it('drops control, escape and bidi characters but keeps naira and dots', () => {
    expect(sanitizeForTerminal('A\u001b[31mred\u0007‮x ₦ ••••6789\n')).toBe(
      'A[31mredx ₦ ••••6789'
    );
  });
});

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

describe('refusalMessage', () => {
  it('explains known refusals in plain words', () => {
    expect(refusalMessage('ops_approval_requester_cannot_approve')).toMatch(
      /opened this request/
    );
    expect(refusalMessage('ops_approval_not_an_approver')).toMatch(
      /approver login/
    );
  });

  it('falls back to a generic message', () => {
    expect(refusalMessage('something_else')).toBe(
      'The database refused this decision. Nothing was recorded.'
    );
  });
});
