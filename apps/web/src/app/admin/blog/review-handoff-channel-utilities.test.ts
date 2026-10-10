import { describe, expect, it } from 'vitest';
import { isChannelUtility } from './review-handoff-channel-utilities';

describe('isChannelUtility', () => {
  it.each([
    'hidden',
    'visible',
    'invisible',
    'collapse',
    'sr-only',
    'not-sr-only',
    'block',
    'flex',
    'scale-0',
    'w-0',
    'opacity-0',
    'opacity-100',
    'text-transparent',
    'text-black',
    'overflow-hidden',
    'line-clamp-2',
  ])('flags channel utilities: %s', (utility) => {
    expect(isChannelUtility(utility)).toBe(true);
  });

  it.each([
    'p-4',
    'font-bold',
    'md:block',
    'hover:hidden',
    '',
    'hiddenx',
  ])('ignores non-channel utilities: %s', (utility) => {
    expect(isChannelUtility(utility)).toBe(false);
  });
});
