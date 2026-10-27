import { describe, expect, it } from 'vitest';
import { xEventIdsSchema } from '@/schemas/x-ads-settings';
import { parseXEventIds } from './parse-x-event-ids';

const CODE = 'tw-abc123-xyz789';

const CASES: [string, unknown][] = [
  ['empty object', {}],
  ['valid single event', { purchase: CODE }],
  [
    'all events',
    {
      pageView: CODE,
      viewContent: CODE,
      addToCart: CODE,
      initiateCheckout: CODE,
      purchase: CODE,
      search: CODE,
      signUp: CODE,
      addToWishlist: CODE,
    },
  ],
  ['trims whitespace', { purchase: `  ${CODE}  ` }],
  ['explicit undefined value', { purchase: undefined }],
  ['unknown key rejected (strict)', { purchase: CODE, other: CODE }],
  ['bad prefix', { purchase: 'xx-abc-def' }],
  ['missing segment', { purchase: 'tw-abc' }],
  ['illegal characters', { purchase: 'tw-abc!-def' }],
  ['pixel segment too long', { purchase: `tw-${'a'.repeat(65)}-def` }],
  ['event segment too long', { purchase: `tw-abc-${'a'.repeat(129)}` }],
  ['non-string value', { purchase: 123 }],
  ['null value', { purchase: null }],
  ['empty string', { purchase: '' }],
  ['null input', null],
  ['undefined input', undefined],
  ['array input', [CODE]],
  ['string input', CODE],
];

describe('parseXEventIds', () => {
  it.each(
    CASES
  )('matches xEventIdsSchema.safeParse for %s', (_label, input) => {
    const expected = xEventIdsSchema.safeParse(input);
    expect(parseXEventIds(input)).toEqual(
      expected.success ? expected.data : null
    );
  });
});
