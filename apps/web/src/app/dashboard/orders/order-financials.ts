import { parseOptionalOrderAmount } from './order-money';
import { type OrderTaxBasis, parseOrderTaxBasis } from './order-tax-basis';

export interface OrderFinancialFields {
  subtotal?: number;
  shipping_fee?: number;
  gift_wrapping_fee?: number;
  tax_amount?: number;
  tax_basis?: OrderTaxBasis | null;
  discount_amount?: number;
}

export function mapOrderFinancialFields(order: {
  subtotal?: string | number | null;
  shipping_fee?: string | number | null;
  gift_wrapping_fee?: string | number | null;
  tax_amount?: string | number | null;
  tax_basis?: string | null;
  discount_amount?: string | number | null;
}): OrderFinancialFields {
  return {
    discount_amount: parseOptionalOrderAmount(order.discount_amount),
    gift_wrapping_fee: parseOptionalOrderAmount(order.gift_wrapping_fee),
    shipping_fee: parseOptionalOrderAmount(order.shipping_fee),
    subtotal: parseOptionalOrderAmount(order.subtotal),
    tax_amount: parseOptionalOrderAmount(order.tax_amount),
    tax_basis: parseOrderTaxBasis(order.tax_basis),
  };
}
