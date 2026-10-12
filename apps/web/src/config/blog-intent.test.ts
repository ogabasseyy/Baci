import { describe, expect, it } from 'vitest';
import { BLOG_INTENTS } from './blog-intent';

describe('BLOG_INTENTS', () => {
  it('matches the supported intent taxonomy', () => {
    expect([...BLOG_INTENTS]).toEqual([
      'news',
      'comparison',
      'repair-guide',
      'buying-guide',
      'platform',
      'unknown',
    ]);
  });
});
