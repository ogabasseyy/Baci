import { expect, it } from 'vitest';

import { stripLeadingNonRenderingText } from './strip-leading-non-rendering-text';

it.each([
  ['  \n\t{"type":"doc"}', '{"type":"doc"}'],
  ['\u200B{"type":"doc"}', '{"type":"doc"}'],
  ['\u2063\u200D{"type":"doc"}', '{"type":"doc"}'],
  ['\uFEFF\u00AD{"type":"doc"}', '{"type":"doc"}'],
  ['  \u200B\u2066{"type":"doc"}', '{"type":"doc"}'],
  ['<p>kept</p>', '<p>kept</p>'],
  ['{"type":"kept \u200B inside"}', '{"type":"kept \u200B inside"}'],
])('strips only invisible leading characters: %s', (value, expected) => {
  expect(stripLeadingNonRenderingText(value)).toBe(expected);
});
