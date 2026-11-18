import { describe, expect, it } from 'vitest';
import {
  AGENT_COURTESY_PATTERN,
  CATALOG_AGENT_CUE,
  CATALOG_FOLLOW_UP_CUE,
  READ_ONLY_AGENT_ACTION_CLAIM,
  shouldAttemptCatalogAgent,
} from './ogabassey-catalog-agent-lexicon';

describe('ogabassey-catalog-agent-lexicon', () => {
  it('matches direct catalog shopping cues while excluding courtesy and non-product pixel queries', () => {
    for (const prompt of [
      'pixels',
      'pixels?',
      'Best Pixel?',
      'Show laptops under ₦2m',
      'Any Galaxy?',
      'Gaming rig?',
      'Do you carry Sony WH-1000XM5?',
    ]) {
      expect(CATALOG_AGENT_CUE.test(prompt)).toBe(true);
      expect(
        shouldAttemptCatalogAgent([{ role: 'user', content: prompt }])
      ).toBe(true);
    }

    for (const nonShopping of [
      'Hello!',
      'Why is my photo pixelated?',
      'What is the pixel density of the screen?',
      'show pixels per inch',
      'What is the cost of living?',
    ]) {
      expect(CATALOG_AGENT_CUE.test(nonShopping)).toBe(false);
      expect(
        shouldAttemptCatalogAgent([{ role: 'user', content: nonShopping }])
      ).toBe(false);
    }

    expect(AGENT_COURTESY_PATTERN.test('Thanks!')).toBe(true);
  });

  it('activates follow-up cues only after a prior catalog turn and flags read-only cart/order claims', () => {
    expect(CATALOG_FOLLOW_UP_CUE.test('Anything cheaper?')).toBe(true);
    expect(
      shouldAttemptCatalogAgent([
        { role: 'user', content: 'Tell me a joke' },
        { role: 'user', content: 'Anything cheaper?' },
      ])
    ).toBe(false);

    expect(
      shouldAttemptCatalogAgent([
        { role: 'user', content: 'Show laptops under ₦2m' },
        { role: 'assistant', content: 'Checking under ₦2,000,000.' },
        { role: 'user', content: 'Any cheaper one?' },
      ])
    ).toBe(true);

    expect(
      READ_ONLY_AGENT_ACTION_CLAIM.test(
        "I've added the Apple MacBook Air M2 to your cart."
      )
    ).toBe(true);
    expect(
      READ_ONLY_AGENT_ACTION_CLAIM.test(
        'Apple MacBook Air M2 is ₦1,450,000 in stock.'
      )
    ).toBe(false);
  });
});
