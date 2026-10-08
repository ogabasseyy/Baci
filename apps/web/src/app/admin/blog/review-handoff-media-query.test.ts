import { expect, it } from 'vitest';

import { isNeverMatchingMediaQuery } from './review-handoff-media-query';

it.each([
  'not all',
  'NOT ALL',
  '  not   all  ',
  '(',
  ')',
  '((min-width: 1px)',
  '(min-width: 1px))',
  '()',
  '(   )',
  '"(min-width: 1px)',
  '[color]',
  'not all, (',
  '(, [x]',
  '(, screen',
])('detects a never-matching media value: %s', (value) => {
  expect(isNeverMatchingMediaQuery(value)).toBe(true);
});

it.each([
  '',
  '   ',
  ',',
  'screen',
  'all',
  '(min-width: 100px)',
  '((min-width: 100px))',
  'screen and (color)',
  'not all, screen',
  '), screen',
  '(orientation: "(")',
  'not screen',
])('keeps a possibly-matching media value applicable: %s', (value) => {
  expect(isNeverMatchingMediaQuery(value)).toBe(false);
});
