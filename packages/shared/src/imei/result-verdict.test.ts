import { expect, it } from 'vitest';
import { getImeiEffectiveVerdict, getImeiFinanceState } from './result-verdict';

it('does not display a cached safe verdict when finance is past due', () => {
  expect(
    getImeiEffectiveVerdict({
      status: 'Clean',
      verdictType: 'safe',
      verdict: 'SAFE TO BUY',
      financeStatus: 'Past Due',
    })
  ).toMatchObject({ type: 'caution' });
});
it('preserves a stronger danger verdict', () => {
  expect(
    getImeiEffectiveVerdict({
      status: 'Blacklisted',
      verdictType: 'danger',
      verdict: 'Reported stolen',
      financeStatus: 'Past Due',
    })
  ).toEqual({ type: 'danger', text: 'Reported stolen' });
});
it('does not treat no outstanding balance as a finance concern', () => {
  expect(
    getImeiEffectiveVerdict({
      status: 'Clean',
      verdictType: 'safe',
      verdict: 'Safe',
      financeStatus: 'No outstanding balance',
      blacklistStatus: 'Clean',
    }).type
  ).toBe('safe');
});

it.each([
  'Paid / Unpaid',
  'Past Due / Unpaid',
])('negative finance evidence wins in %s', (financeStatus) => {
  expect(
    getImeiEffectiveVerdict({
      status: 'Clean',
      verdictType: 'safe',
      verdict: 'Safe',
      financeStatus,
    }).text
  ).toContain('overdue payment');
});
it('treats ambiguous finance as caution without asserting a debt', () => {
  expect(
    getImeiEffectiveVerdict({
      status: 'Clean',
      verdictType: 'safe',
      verdict: 'Safe',
      financeStatus: 'Pending',
    })
  ).toEqual({
    type: 'caution',
    text: 'The finance status is unclear. Verify it before buying.',
  });
});

it.each([
  [undefined, 'unchecked'],
  ['No outstanding balance', 'clear'],
  ['Paid / Unpaid', 'risk'],
  ['Pending', 'unknown'],
] as const)('classifies finance evidence %s as %s', (value, expected) => {
  expect(getImeiFinanceState(value)).toBe(expected);
});

it.each([
  ['Blacklisted', 'danger'],
  ['Unknown', 'caution'],
  [undefined, 'caution'],
] as const)('does not show a safe verdict for blacklist evidence %s', (blacklistStatus, type) => {
  expect(
    getImeiEffectiveVerdict({
      status: 'Clean',
      verdictType: 'safe',
      verdict: 'SAFE TO BUY',
      blacklistStatus,
    }).type
  ).toBe(type);
});

it('does not label a generic device risk as a blacklist risk', () => {
  expect(
    getImeiEffectiveVerdict({
      status: 'Blacklisted',
      verdictType: 'safe',
      verdict: 'SAFE TO BUY',
      blacklistStatus: 'Clean',
    })
  ).toEqual({
    type: 'danger',
    text: 'Device risk detected. Verify this report before buying.',
  });
});
