import { describe, expect, it } from 'vitest';
import {
  COMMERCIAL_GUIDE_GAME_CATEGORY_PATTERN,
  CONSOLE_BRAND_NAMES,
  GAME_CATEGORY_PATTERN,
} from './storefront-game-category';

describe('GAME_CATEGORY_PATTERN', () => {
  it('matches supported game and console category slugs', () => {
    expect(GAME_CATEGORY_PATTERN.test('gaming')).toBe(true);
    expect(GAME_CATEGORY_PATTERN.test('portable-gaming')).toBe(true);
    expect(GAME_CATEGORY_PATTERN.test('playstation-5')).toBe(true);
    expect(GAME_CATEGORY_PATTERN.test('playstation-4')).toBe(true);
    expect(GAME_CATEGORY_PATTERN.test('nintendo-switch')).toBe(true);
    expect(GAME_CATEGORY_PATTERN.test('nintendo-switch-2')).toBe(true);
    expect(GAME_CATEGORY_PATTERN.test('xbox')).toBe(true);
  });

  it('deliberately rejects gaming-accessories for product model and game product detection', () => {
    expect(GAME_CATEGORY_PATTERN.test('gaming-accessories')).toBe(false);
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

describe('COMMERCIAL_GUIDE_GAME_CATEGORY_PATTERN', () => {
  it('matches gaming categories including gaming-accessories for guide link matching', () => {
    expect(COMMERCIAL_GUIDE_GAME_CATEGORY_PATTERN.test('gaming')).toBe(true);
    expect(
      COMMERCIAL_GUIDE_GAME_CATEGORY_PATTERN.test('gaming-accessories')
    ).toBe(true);
    expect(COMMERCIAL_GUIDE_GAME_CATEGORY_PATTERN.test('portable-gaming')).toBe(
      true
    );
    expect(COMMERCIAL_GUIDE_GAME_CATEGORY_PATTERN.test('playstation-5')).toBe(
      true
    );
    expect(COMMERCIAL_GUIDE_GAME_CATEGORY_PATTERN.test('xbox')).toBe(true);
  });

  it('rejects non-gaming categories', () => {
    expect(COMMERCIAL_GUIDE_GAME_CATEGORY_PATTERN.test('smartphones')).toBe(
      false
    );
    expect(COMMERCIAL_GUIDE_GAME_CATEGORY_PATTERN.test('laptops')).toBe(false);
  });
});

describe('CONSOLE_BRAND_NAMES', () => {
  it('contains expected console brands', () => {
    expect(CONSOLE_BRAND_NAMES.has('ps4')).toBe(true);
    expect(CONSOLE_BRAND_NAMES.has('ps5')).toBe(true);
    expect(CONSOLE_BRAND_NAMES.has('playstation')).toBe(true);
    expect(CONSOLE_BRAND_NAMES.has('xbox')).toBe(true);
    expect(CONSOLE_BRAND_NAMES.has('switch')).toBe(true);
    expect(CONSOLE_BRAND_NAMES.has('nintendo')).toBe(true);
  });

  it('does not contain non-console brands', () => {
    expect(CONSOLE_BRAND_NAMES.has('apple')).toBe(false);
    expect(CONSOLE_BRAND_NAMES.has('samsung')).toBe(false);
    expect(CONSOLE_BRAND_NAMES.has('razer')).toBe(false);
  });
});
