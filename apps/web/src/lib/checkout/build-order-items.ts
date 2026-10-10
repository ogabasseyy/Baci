import { DEFAULT_ASSURANCE_RATE } from '@/lib/checkout/constants';

type CheckoutOrderItemCondition = 'new' | 'used' | 'open_box' | 'refurbished';

export interface CheckoutOrderItemInput {
  id: string | number;
  product_id?: string | number;
  condition?: CheckoutOrderItemCondition;
  name: string;
  quantity: number;
  price: number;
  negotiatedPrice?: number;
  image?: string;
  image_url?: string;
  variantId?: string;
  offerId?: string;
  variantAttributes?: Record<string, string>;
  selectedColor?: string;
  selectedStorage?: string;
  hasAssurance?: boolean;
  assuranceRate?: number;
  quizAwardId?: string;
  quizVoucherToken?: string;
}

export interface CheckoutOrderItem {
  condition?: CheckoutOrderItemCondition;
  product_id: string;
  name: string;
  quantity: number;
  price: number;
  value: number;
  image?: string;
  image_url?: string;
  variantId?: string;
  offer_id?: string;
  variantAttributes: Record<string, string>;
  voucher_award_id?: string;
  voucher_token?: string;
  has_assurance: boolean;
  assurance_fee: number;
}

export function buildCheckoutOrderItems(
  cart: CheckoutOrderItemInput[]
): CheckoutOrderItem[] {
  return cart.map((item) => {
    const effectivePrice = item.negotiatedPrice ?? item.price;
    const variantAttributes = { ...(item.variantAttributes ?? {}) };
    const hasQuizVoucher = Boolean(item.quizAwardId && item.quizVoucherToken);
    const checkoutPrice = hasQuizVoucher ? 0 : effectivePrice;

    if (item.selectedColor && !variantAttributes.color) {
      variantAttributes.color = item.selectedColor;
    }

    if (item.selectedStorage && !variantAttributes.storage) {
      variantAttributes.storage = item.selectedStorage;
    }

    return {
      condition: item.condition,
      product_id: String(item.product_id ?? item.id),
      name: item.name,
      quantity: item.quantity,
      price: checkoutPrice,
      value: checkoutPrice * item.quantity,
      image: item.image,
      image_url: item.image_url,
      variantId: item.variantId,
      offer_id: item.offerId,
      variantAttributes,
      ...(hasQuizVoucher
        ? {
            voucher_award_id: item.quizAwardId,
            voucher_token: item.quizVoucherToken,
          }
        : {}),
      has_assurance: item.hasAssurance || false,
      assurance_fee: item.hasAssurance
        ? checkoutPrice *
          item.quantity *
          (item.assuranceRate ?? DEFAULT_ASSURANCE_RATE)
        : 0,
    };
  });
}
