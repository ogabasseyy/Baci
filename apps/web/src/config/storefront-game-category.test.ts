import { describe, expect, it } from 'vitest';
import { GAME_CATEGORY_PATTERN } from './storefront-game-category';

describe('GAME_CATEGORY_PATTERN', () => {
  it('matches supported game and console category slugs', () => {
    expect(GAME_CATEGORY_PATTERN.test('gaming')).toBe(true);
    expect(GAME_CATEGORY_PATTERN.test('gaming-accessories')).toBe(true);
    expect(GAME_CATEGORY_PATTERN.test('portable-gaming')).toBe(true);
    expect(GAME_CATEGORY_PATTERN.test('playstation-5')).toBe(true);
    expect(GAME_CATEGORY_PATTERN.test('playstation-4')).toBe(true);
    expect(GAME_CATEGORY_PATTERN.test('nintendo-switch')).toBe(true);
    expect(GAME_CATEGORY_PATTERN.test('nintendo-switch-2')).toBe(true);
    expect(GAME_CATEGORY_PATTERN.test('xbox')).toBe(true);
  });

  it('rejects non-gaming category slugs', () => {
    expect(GAME_CATEGORY_PATTERN.test('smartphones')).toBe(false);
    expect(GAME_CATEGORY_PATTERN.test('laptops')).toBe(false);
    expect(GAME_CATEGORY_PATTERN.test('gaming-laptops')).toBe(false);
    expect(GAME_CATEGORY_PATTERN.test('tablets')).toBe(false);
    expect(GAME_CATEGORY_PATTERN.test('smartwatches')).toBe(false);
    expect(GAME_CATEGORY_PATTERN.test('audio')).toBe(false);
  });
});
