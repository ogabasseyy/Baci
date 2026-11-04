import { describe, expect, it } from 'vitest';
import {
  isRedundantPlatformListParenthetical,
  PLATFORM_ID_BY_ALIAS,
  stripRedundantPlatformParentheticals,
} from './seo-meta-title-platform-compaction';

describe('seo-meta-title-platform-compaction', () => {
  describe('PLATFORM_ID_BY_ALIAS', () => {
    it('defines canonical platform aliases for gaming hardware and pc families', () => {
      expect(PLATFORM_ID_BY_ALIAS.ps5).toBe('ps5');
      expect(PLATFORM_ID_BY_ALIAS['playstation 5']).toBe('ps5');
      expect(PLATFORM_ID_BY_ALIAS['ps5 pro']).toBe('ps5');
      expect(PLATFORM_ID_BY_ALIAS['ps5 slim']).toBe('ps5');
      expect(PLATFORM_ID_BY_ALIAS.ps4).toBe('ps4');
      expect(PLATFORM_ID_BY_ALIAS['playstation 4']).toBe('ps4');
      expect(PLATFORM_ID_BY_ALIAS['xbox series x']).toBe('xbox-series');
      expect(PLATFORM_ID_BY_ALIAS['xbox series s']).toBe('xbox-series');
      expect(PLATFORM_ID_BY_ALIAS['xbox one']).toBe('xbox-one');
      expect(PLATFORM_ID_BY_ALIAS.switch).toBe('switch');
      expect(PLATFORM_ID_BY_ALIAS['switch oled']).toBe('switch');
      expect(PLATFORM_ID_BY_ALIAS['switch 2']).toBe('switch-2');
      expect(PLATFORM_ID_BY_ALIAS.pc).toBe('pc');
      expect(PLATFORM_ID_BY_ALIAS.steam).toBe('pc');
      expect(PLATFORM_ID_BY_ALIAS['steam deck']).toBe('pc');
      expect(Object.isFrozen(PLATFORM_ID_BY_ALIAS)).toBe(true);
    });
  });

  describe('isRedundantPlatformListParenthetical', () => {
    it('identifies redundant multi-platform lists', () => {
      expect(isRedundantPlatformListParenthetical('PS5, PS4')).toBe(true);
      expect(isRedundantPlatformListParenthetical('PS5 / Xbox')).toBe(true);
      expect(isRedundantPlatformListParenthetical('PS5, Xbox, Switch')).toBe(
        true
      );
      expect(isRedundantPlatformListParenthetical('PC / Windows / PS5')).toBe(
        true
      );
      expect(isRedundantPlatformListParenthetical('PS5 - PS4')).toBe(true);
      expect(isRedundantPlatformListParenthetical('PS5 – PS4')).toBe(true);
      expect(isRedundantPlatformListParenthetical('PS5 — PS4')).toBe(true);
      expect(isRedundantPlatformListParenthetical('PS5-PS4')).toBe(true);
      expect(
        isRedundantPlatformListParenthetical('PS5, Xbox Series X & S')
      ).toBe(true);
      expect(
        isRedundantPlatformListParenthetical('PS5, Xbox Series X and S')
      ).toBe(true);
      expect(isRedundantPlatformListParenthetical('PS5, Series X & S')).toBe(
        true
      );
      expect(isRedundantPlatformListParenthetical('PS5, Series S and X')).toBe(
        true
      );
      expect(isRedundantPlatformListParenthetical('Xbox, PS5')).toBe(true);
      expect(isRedundantPlatformListParenthetical('PS5 or Xbox')).toBe(true);
      expect(isRedundantPlatformListParenthetical('PS5 or PS4')).toBe(true);
      expect(
        isRedundantPlatformListParenthetical('Xbox Series X or S, PS5')
      ).toBe(true);
      expect(
        isRedundantPlatformListParenthetical('Xbox, Xbox Series X, PS5')
      ).toBe(true);
    });

    it('returns false for single-platform qualifiers and revisions', () => {
      expect(isRedundantPlatformListParenthetical('PS5')).toBe(false);
      expect(isRedundantPlatformListParenthetical('PS5 Pro')).toBe(false);
      expect(isRedundantPlatformListParenthetical('PS5 Slim')).toBe(false);
      expect(isRedundantPlatformListParenthetical('PS4 Pro')).toBe(false);
      expect(isRedundantPlatformListParenthetical('Xbox Series X')).toBe(false);
      expect(isRedundantPlatformListParenthetical('Xbox Series S')).toBe(false);
      expect(isRedundantPlatformListParenthetical('Xbox Series X|S')).toBe(
        false
      );
      expect(isRedundantPlatformListParenthetical('Xbox Series X & S')).toBe(
        false
      );
      expect(isRedundantPlatformListParenthetical('Xbox Series X and S')).toBe(
        false
      );
      expect(isRedundantPlatformListParenthetical('Xbox Series X or S')).toBe(
        false
      );
      expect(isRedundantPlatformListParenthetical('Series X & S')).toBe(false);
      expect(isRedundantPlatformListParenthetical('Series S and X')).toBe(
        false
      );
      expect(isRedundantPlatformListParenthetical('Series X or S')).toBe(false);
      expect(isRedundantPlatformListParenthetical('Nintendo Switch OLED')).toBe(
        false
      );
    });

    it('returns false for single-platform synonym and generic+specific lists', () => {
      expect(isRedundantPlatformListParenthetical('PS5 / PlayStation 5')).toBe(
        false
      );
      expect(isRedundantPlatformListParenthetical('PC / Windows / Steam')).toBe(
        false
      );
      expect(isRedundantPlatformListParenthetical('Xbox, Xbox Series X')).toBe(
        false
      );
      expect(isRedundantPlatformListParenthetical('Xbox, Xbox One')).toBe(
        false
      );
      expect(isRedundantPlatformListParenthetical('Xbox / Xbox Series X')).toBe(
        false
      );
      expect(
        isRedundantPlatformListParenthetical('Xbox Series X, Xbox Series S')
      ).toBe(false);
      expect(
        isRedundantPlatformListParenthetical('Switch, Nintendo Switch')
      ).toBe(false);
    });

    it('returns false for unknown or non-platform qualifiers', () => {
      expect(isRedundantPlatformListParenthetical('Disc Edition')).toBe(false);
      expect(isRedundantPlatformListParenthetical('PS5, Disc Edition')).toBe(
        false
      );
      expect(isRedundantPlatformListParenthetical('Brand New')).toBe(false);
      expect(isRedundantPlatformListParenthetical('')).toBe(false);
    });
  });

  describe('stripRedundantPlatformParentheticals', () => {
    it('strips redundant multi-platform parentheticals', () => {
      expect(
        stripRedundantPlatformParentheticals(
          'Buy EA Sports FC 27 (PS5, PS4, Xbox) Online'
        )
      ).toBe('Buy EA Sports FC 27 Online');
    });

    it('strips platform lists at start and cleans leading punctuation', () => {
      expect(
        stripRedundantPlatformParentheticals('(PS5, PS4): Best Deals')
      ).toBe('Best Deals');
      expect(
        stripRedundantPlatformParentheticals('(PS5, PS4) - Best Deals')
      ).toBe('Best Deals');
      expect(
        stripRedundantPlatformParentheticals('(PS5, PS4), Best Deals')
      ).toBe('Best Deals');
      expect(
        stripRedundantPlatformParentheticals('(PS5 or PS4) or Best Deals')
      ).toBe('Best Deals');
      expect(
        stripRedundantPlatformParentheticals('(PS5, PS4) AND Best Deals')
      ).toBe('Best Deals');
      expect(
        stripRedundantPlatformParentheticals('(PS5, PS4) Or Best Deals')
      ).toBe('Best Deals');
    });

    it('strips platform lists at end and cleans trailing separators', () => {
      expect(stripRedundantPlatformParentheticals('Buy Game (PS5, PS4)')).toBe(
        'Buy Game'
      );
      expect(
        stripRedundantPlatformParentheticals('Buy Game (PS5 or Xbox)')
      ).toBe('Buy Game');
      expect(
        stripRedundantPlatformParentheticals('Buy Game - (PS5, PS4)')
      ).toBe('Buy Game');
      expect(
        stripRedundantPlatformParentheticals('Buy Game (PS5, PS4) -')
      ).toBe('Buy Game');
      expect(
        stripRedundantPlatformParentheticals('Buy Game (PS5, PS4) and')
      ).toBe('Buy Game');
      expect(
        stripRedundantPlatformParentheticals('Buy Game (PS5, PS4) And')
      ).toBe('Buy Game');
      expect(
        stripRedundantPlatformParentheticals('Buy Game (PS5, PS4) or')
      ).toBe('Buy Game');
      expect(
        stripRedundantPlatformParentheticals('Buy Game (PS5, PS4) OR')
      ).toBe('Buy Game');
      expect(
        stripRedundantPlatformParentheticals('Buy Game (PS5, PS4) |')
      ).toBe('Buy Game');
    });

    it('preserves single-platform qualifiers', () => {
      expect(
        stripRedundantPlatformParentheticals('Forza (Xbox Series X)')
      ).toBe('Forza (Xbox Series X)');
      expect(
        stripRedundantPlatformParentheticals('Forza (Xbox, Xbox Series X)')
      ).toBe('Forza (Xbox, Xbox Series X)');
      expect(
        stripRedundantPlatformParentheticals(
          'EA Sports FC 27 (PS5 / PlayStation 5)'
        )
      ).toBe('EA Sports FC 27 (PS5 / PlayStation 5)');
    });

    it('cleans preceding conjunctions and collapses adjoining separators for mid-title lists', () => {
      expect(
        stripRedundantPlatformParentheticals('Buy Game and (PS5, PS4) Edition')
      ).toBe('Buy Game Edition');
      expect(
        stripRedundantPlatformParentheticals('Buy Game And (PS5, PS4) Edition')
      ).toBe('Buy Game Edition');
      expect(
        stripRedundantPlatformParentheticals('Buy Game & (PS5, PS4) Edition')
      ).toBe('Buy Game Edition');
      expect(
        stripRedundantPlatformParentheticals('Buy Game or (PS5, PS4) Edition')
      ).toBe('Buy Game Edition');
      expect(
        stripRedundantPlatformParentheticals('Buy Game Or (PS5, PS4) Edition')
      ).toBe('Buy Game Edition');
      expect(
        stripRedundantPlatformParentheticals('Buy Game OR (PS5, PS4) Edition')
      ).toBe('Buy Game Edition');
      expect(
        stripRedundantPlatformParentheticals(
          'Buy EA Sports FC 27 - (PS5, PS4, Xbox, Switch) - ₦112,000'
        )
      ).toBe('Buy EA Sports FC 27 - ₦112,000');
    });

    it('preserves nested platform lists inside non-platform qualifiers', () => {
      expect(
        stripRedundantPlatformParentheticals(
          'Game (Special Edition (PS5, PS4)) Now'
        )
      ).toBe('Game (Special Edition (PS5, PS4)) Now');
      expect(
        stripRedundantPlatformParentheticals(
          'Game (Special Edition (PS5, PS4)) Now (Xbox, PC)'
        )
      ).toBe('Game (Special Edition (PS5, PS4)) Now');
    });

    it('preserves distant double spaces and punctuation', () => {
      expect(
        stripRedundantPlatformParentheticals(
          'Deal  of the Day (PS5, PS4) Sale  Now'
        )
      ).toBe('Deal  of the Day Sale  Now');
    });

    it('executes without exponential backtracking on long separator runs', () => {
      const runOfSeparators = '-'.repeat(50);
      expect(
        stripRedundantPlatformParentheticals(
          `Game ${runOfSeparators} (PS5, PS4) Sale`
        )
      ).toBe(`Game ${runOfSeparators} Sale`);
    });

    it('executes without quadratic rescans on unbalanced parentheses', () => {
      const unbalancedNoClosing = '('.repeat(5000);
      expect(stripRedundantPlatformParentheticals(unbalancedNoClosing)).toBe(
        unbalancedNoClosing
      );

      const unbalancedWithClosing = `${'('.repeat(5000)})`;
      expect(stripRedundantPlatformParentheticals(unbalancedWithClosing)).toBe(
        unbalancedWithClosing
      );
    });
  });
});
