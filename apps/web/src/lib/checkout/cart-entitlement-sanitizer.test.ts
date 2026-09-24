import { describe, expect, it } from 'vitest';
import type { CartItem } from '@/hooks/cart';
import {
  calculateCartCatalogSubtotal,
  calculateCartItemSubtotal,
  calculateCartTotal,
  getCartItemCheckoutUnitPrice,
  isQuizVoucherCartItem,
  sanitizeCartItems,
} from './cart-entitlement-sanitizer';

describe('cart-entitlement-sanitizer', () => {
  const mockCart: CartItem[] = [
    {
      id: '1',
      cartItemId: '1::v1',
      name: 'Item 1',
      price: 1000,
      quantity: 2,
      negotiatedPrice: 800,
      negotiationStatus: 'accepted',
      cartDiscount: 400,
      hasAssurance: true,
      assuranceRate: 0.05,
    } as CartItem,
    {
      id: '2',
      cartItemId: '2::v2',
      name: 'Item 2',
      price: 2000,
      quantity: 1,
      hasAssurance: false,
    } as CartItem,
  ];

  describe('sanitizeCartItems', () => {
    it('should strip negotiation fields when hasPriceNegotiation is false', () => {
      const sanitized = sanitizeCartItems(mockCart, false);
      expect(sanitized[0].negotiatedPrice).toBeUndefined();
      expect(sanitized[0].negotiationStatus).toBeUndefined();
      expect(sanitized[0].cartDiscount).toBeUndefined();
      // Should not touch standard fields
      expect(sanitized[0].price).toBe(1000);
      expect(sanitized[0].quantity).toBe(2);
      expect(sanitized[0].hasAssurance).toBe(true);

      // Item 2 should remain unchanged
      expect(sanitized[1].price).toBe(2000);
    });

    it('should preserve negotiation fields when hasPriceNegotiation is true', () => {
      const sanitized = sanitizeCartItems(mockCart, true);
      expect(sanitized[0].negotiatedPrice).toBe(800);
      expect(sanitized[0].negotiationStatus).toBe('accepted');
      expect(sanitized[0].cartDiscount).toBe(400);
    });
  });

  describe('calculateCartTotal', () => {
    it('should calculate total with standard prices and quantity-aware assurance when negotiation is not entitled', () => {
      // Item 1: price = 1000, qty = 2, itemTotal = 2000. hasAssurance = true, assurance = 2000 * 0.05 = 100. Total = 2100.
      // Item 2: price = 2000, qty = 1, itemTotal = 2000. hasAssurance = false, assurance = 0. Total = 2000.
      // Total = 4100.
      const total = calculateCartTotal(mockCart, false);
      expect(total).toBe(4100);
    });

    it('should calculate total with negotiated prices and quantity-aware assurance when negotiation is entitled', () => {
      // Item 1: negotiatedPrice = 800, qty = 2, itemTotal = 1600. hasAssurance = true, assurance = 1600 * 0.05 = 80. Total = 1680.
      // Item 2: price = 2000, qty = 1, itemTotal = 2000. hasAssurance = false, assurance = 0. Total = 2000.
      // Total = 3680.
      const total = calculateCartTotal(mockCart, true);
      expect(total).toBe(3680);
    });

    it('treats signed quiz voucher items as zero-priced gifts', () => {
      const cartWithVoucherGift: CartItem[] = [
        mockCart[1],
        {
          id: 'gift-product',
          cartItemId: 'gift-product::quiz',
          name: 'Quiz Gift',
          price: 205000,
          quantity: 1,
          quizAwardId: 'award-1',
          quizVoucherToken: 'signed-token',
          hasAssurance: true,
        } as CartItem,
      ];

      expect(isQuizVoucherCartItem(cartWithVoucherGift[1])).toBe(true);
      expect(getCartItemCheckoutUnitPrice(cartWithVoucherGift[1])).toBe(0);
      expect(calculateCartItemSubtotal(cartWithVoucherGift, false)).toBe(2000);
      expect(calculateCartTotal(cartWithVoucherGift, false)).toBe(2000);
    });

    it('keeps signed quiz voucher gifts free when negotiated price is present', () => {
      const voucherGift = {
        id: 'gift-product',
        cartItemId: 'gift-product::quiz',
        name: 'Quiz Gift',
        price: 205000,
        negotiatedPrice: 50000,
        negotiationStatus: 'accepted',
        quantity: 2,
        quizAwardId: 'award-1',
        quizVoucherToken: 'signed-token',
      } as CartItem;

      expect(isQuizVoucherCartItem(voucherGift)).toBe(true);
      expect(getCartItemCheckoutUnitPrice(voucherGift)).toBe(0);
      expect(calculateCartItemSubtotal([voucherGift], true)).toBe(0);
      expect(calculateCartTotal([voucherGift], true)).toBe(0);
    });

    it('uses negotiated subtotals only when negotiation is entitled', () => {
      const negotiatedCart = [
        {
          id: '1',
          cartItemId: '1::v1',
          name: 'Item 1',
          price: 1000,
          negotiatedPrice: 800,
          negotiationStatus: 'accepted',
          quantity: 2,
        } as CartItem,
      ];

      expect(calculateCartItemSubtotal(negotiatedCart, true)).toBe(1600);
      expect(calculateCartItemSubtotal(negotiatedCart, false)).toBe(2000);
    });

    it('keeps quiz award items priced until the signed voucher token is present', () => {
      const incompleteVoucherItem = {
        id: 'gift-product',
        cartItemId: 'gift-product::quiz',
        name: 'Quiz Gift',
        price: 205000,
        quantity: 1,
        quizAwardId: 'award-1',
      } as CartItem;

      expect(isQuizVoucherCartItem(incompleteVoucherItem)).toBe(false);
      expect(getCartItemCheckoutUnitPrice(incompleteVoucherItem)).toBe(205000);
    });

    it('should treat invalid prices as 0 while preserving valid item totals', () => {
      const cartWithInvalidPrice: CartItem[] = [
        {
          ...mockCart[0],
          price: Number.NaN,
          negotiatedPrice: undefined,
        },
        mockCart[1],
      ];

      expect(calculateCartTotal(cartWithInvalidPrice, false)).toBe(2000);
    });

    it('should normalize missing quantities to 0', () => {
      const cartWithMissingQuantity: CartItem[] = [
        {
          ...mockCart[0],
          quantity: undefined as unknown as number,
        },
        mockCart[1],
      ];

      expect(calculateCartTotal(cartWithMissingQuantity, false)).toBe(2000);
    });

    it('should return 0 for an empty cart', () => {
      expect(calculateCartTotal([], false)).toBe(0);
    });

    it('throws when cart total calculation receives malformed cart input', () => {
      expect(() =>
        calculateCartTotal(null as unknown as CartItem[], false)
      ).toThrow(TypeError);
    });
  });

  describe('calculateCartCatalogSubtotal', () => {
    it('prices goods at the catalog price even when a negotiated price is applied', () => {
      // Item 1: catalog goods = 1000 * 2 = 2000; assurance basis tracks the
      //   negotiated price (800) => 800 * 2 * 0.05 = 80. Line = 2080.
      // Item 2: catalog goods = 2000 * 1 = 2000; no assurance. Line = 2000.
      // Catalog subtotal = 4080 — NOT the negotiated calculateCartTotal (3680).
      expect(calculateCartCatalogSubtotal(mockCart, true)).toBe(4080);
      expect(calculateCartTotal(mockCart, true)).toBe(3680);
    });

    it('prices condition-offer lines at the retained catalog basis', () => {
      const offerLine: CartItem = {
        ...mockCart[0],
        price: 600,
        catalogPrice: 1000,
      };
      // Goods use catalog (1000 x 2), not the offer price (600 x 2): a
      // merchant-rate tier between 1200 and 2000 must see 2000. Assurance
      // still tracks the negotiated basis: 800 x 2 x 0.05 = 80.
      expect(calculateCartCatalogSubtotal([offerLine], true)).toBe(2080);
    });

    it('falls back to the line price when the retained basis is invalid', () => {
      const fallbackLine: CartItem = {
        ...mockCart[0],
        price: 600,
        catalogPrice: Number.NaN,
      };
      expect(calculateCartCatalogSubtotal([fallbackLine], true)).toBe(1280);
    });

    it('pins assurance to the server rate instead of the item rate', () => {
      const customRateCart: CartItem[] = [
        {
          ...mockCart[0],
          assuranceRate: 0.09,
        },
      ];
      // Goods use catalog: 1000 * 2 = 2000; assurance uses the 0.05 server
      // default, not 0.09: 800 * 2 * 0.05 = 80. Line = 2080.
      expect(calculateCartCatalogSubtotal(customRateCart, true)).toBe(2080);
    });

    it('matches calculateCartTotal when negotiation is not entitled', () => {
      // Sanitizing strips the negotiated price, so goods and assurance both fall
      // back to the catalog price — the two calculations converge.
      expect(calculateCartCatalogSubtotal(mockCart, false)).toBe(
        calculateCartTotal(mockCart, false)
      );
    });

    it('keeps signed quiz voucher assurance free while still counting catalog goods', () => {
      const voucherGift = {
        id: 'gift-product',
        cartItemId: 'gift-product::quiz',
        name: 'Quiz Gift',
        price: 205000,
        negotiatedPrice: 50000,
        negotiationStatus: 'accepted',
        quantity: 1,
        quizAwardId: 'award-1',
        quizVoucherToken: 'signed-token',
        hasAssurance: true,
      } as CartItem;

      // Goods counted at catalog price (205000); voucher assurance basis is 0.
      expect(calculateCartCatalogSubtotal([voucherGift], true)).toBe(205000);
    });

    it('normalizes invalid catalog prices and quantities to 0', () => {
      const cart: CartItem[] = [
        {
          ...mockCart[0],
          price: Number.NaN,
          negotiatedPrice: undefined,
          hasAssurance: false,
        },
        { ...mockCart[1], quantity: undefined as unknown as number },
      ];

      expect(calculateCartCatalogSubtotal(cart, true)).toBe(0);
    });

    it('should return 0 for an empty cart', () => {
      expect(calculateCartCatalogSubtotal([], false)).toBe(0);
    });
  });
});
