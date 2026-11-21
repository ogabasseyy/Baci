import { expect, it } from 'vitest';
import { brilStashOperatorEnvelope } from './brilstash-operator-envelope';

it('preserves arguments for the selected command schema', () => {
  const input = { action: 'activate', args: { p_window_date: '2026-11-19' } };
  expect(brilStashOperatorEnvelope.parse(input)).toEqual(input);
});

it.each([
  { action: 'unknown', args: {} },
  { action: 'activate', args: {}, unexpected: true },
  { args: {} },
])('rejects an invalid operator envelope %#', (input) => {
  expect(brilStashOperatorEnvelope.safeParse(input).success).toBe(false);
});
