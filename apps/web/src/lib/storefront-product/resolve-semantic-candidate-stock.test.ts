import { describe, expect, it } from 'vitest';
import { resolveSemanticCandidateStock } from './resolve-semantic-candidate-stock';

describe('resolveSemanticCandidateStock', () => {
  describe('unmanaged availability (manage_stock === false)', () => {
    it('returns null when manage_stock is false and stock is zero', () => {
      expect(
        resolveSemanticCandidateStock({
          manage_stock: false,
          stock: 0,
          stock_quantity: 0,
        })
      ).toBeNull();
    });

    it('returns null when manage_stock is false even with positive stock quantities', () => {
      expect(
        resolveSemanticCandidateStock({
          manage_stock: false,
          stock: 10,
          stock_quantity: 5,
        })
      ).toBeNull();
    });
  });

  describe('tracked availability (manage_stock === true or null)', () => {
    it('returns 0 when manage_stock is true and stock is zero', () => {
      expect(
        resolveSemanticCandidateStock({
          manage_stock: true,
          stock: 0,
          stock_quantity: 0,
        })
      ).toBe(0);
    });

    it('returns 0 when manage_stock is null and stock is zero (aligns with PDP policy)', () => {
      expect(
        resolveSemanticCandidateStock({
          manage_stock: null,
          stock: 0,
          stock_quantity: 0,
        })
      ).toBe(0);
    });

    it('returns stock_quantity when manage_stock is true and positive', () => {
      expect(
        resolveSemanticCandidateStock({
          manage_stock: true,
          stock: 0,
          stock_quantity: 15,
        })
      ).toBe(15);
    });

    it('returns stock_quantity when manage_stock is null and positive', () => {
      expect(
        resolveSemanticCandidateStock({
          manage_stock: null,
          stock: 0,
          stock_quantity: 7,
        })
      ).toBe(7);
    });

    it('falls back to legacy positive stock when stock_quantity is zero', () => {
      expect(
        resolveSemanticCandidateStock({
          manage_stock: true,
          stock: 8,
          stock_quantity: 0,
        })
      ).toBe(8);
    });

    it('falls back to legacy positive stock when manage_stock is null', () => {
      expect(
        resolveSemanticCandidateStock({
          manage_stock: null,
          stock: 9,
          stock_quantity: 0,
        })
      ).toBe(9);
    });
  });

  describe('omitted projection (manage_stock === undefined)', () => {
    it('returns 0 when manage_stock is omitted and stock is zero (strict projection boundary)', () => {
      expect(
        resolveSemanticCandidateStock({
          stock: 0,
          stock_quantity: 0,
        })
      ).toBe(0);
    });

    it('returns positive stock_quantity when manage_stock is omitted', () => {
      expect(
        resolveSemanticCandidateStock({
          stock: 0,
          stock_quantity: 12,
        })
      ).toBe(12);
    });

    it('falls back to legacy positive stock when manage_stock is omitted and stock_quantity is 0', () => {
      expect(
        resolveSemanticCandidateStock({
          stock: 9,
          stock_quantity: 0,
        })
      ).toBe(9);
    });
  });
});
