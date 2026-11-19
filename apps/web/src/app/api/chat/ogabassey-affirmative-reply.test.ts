import { describe, expect, it } from 'vitest';
import { isOgabasseyAffirmativeReply } from './ogabassey-affirmative-reply';

describe('affirmative chat replies', () => {
  it.each([
    'Yes',
    'yes please!',
    'Okay',
    'Go ahead',
    'do it.',
  ])('recognizes a short affirmative: %s', (text) =>
    expect(isOgabasseyAffirmativeReply(text)).toBe(true));
  it.each([
    'No',
    'Yes, but I changed my mind',
    'not okay',
  ])('does not turn other requests into an affirmative: %s', (text) =>
    expect(isOgabasseyAffirmativeReply(text)).toBe(false));
});
