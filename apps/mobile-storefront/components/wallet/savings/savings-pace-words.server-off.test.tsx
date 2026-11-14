import { savingsPaceWords } from './savings-pace-words';

describe('savingsPaceWords with PiggyVest off', () => {
  it.each([
    ['daily', 'a day'],
    ['weekly', 'a week'],
    ['monthly', 'a month'],
  ] as const)('words %s as %s', (frequency, words) => {
    expect(savingsPaceWords(frequency)).toBe(words);
  });
});
