import { expect, it } from 'vitest';
import { assertPublicResponseBudget } from './public-response-budget';

it('counts UTF-8 wire bytes rather than JavaScript string length', () => {
  expect(() =>
    assertPublicResponseBudget({ text: '界'.repeat(33000) })
  ).toThrow('PUBLIC_RESPONSE_BUDGET');
  expect(() =>
    assertPublicResponseBudget({ text: '界'.repeat(100) })
  ).not.toThrow();
});
