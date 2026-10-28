import { expect, it } from 'vitest';
import { getImeiEffectiveVerdict } from './result-verdict';

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
