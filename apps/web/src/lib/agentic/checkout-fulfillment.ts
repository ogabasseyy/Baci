import type { GPTFulfillmentOption, GPTTotal } from './checkout';

/** Default fulfillment options and totals for a UCP checkout quote. */
export function buildCheckoutFulfillment(
  fulfillmentOptionId: string | null | undefined,
  itemsBaseAmount: number
): {
  fulfillmentOptions: GPTFulfillmentOption[];
  selectedOptionId: string | undefined;
  totals: GPTTotal[];
} {
  const fulfillmentOptions: GPTFulfillmentOption[] = [
    {
      type: 'pickup',
      id: 'pickup_store_1',
      title: 'Store Pickup',
      subtitle: 'Pick up at Ogabassey Ikeja Store',
      subtotal: 0,
      tax: 0,
      total: 0,
    },
    {
      type: 'shipping',
      id: 'shipping_standard',
      title: 'Standard Delivery',
      subtitle: 'Delivery within Lagos',
      subtotal: 2500,
      tax: 0,
      total: 2500,
    },
  ];
  const selectedOption =
    fulfillmentOptions.find((o) => o.id === fulfillmentOptionId) ??
    fulfillmentOptions[0];
  const fulfillmentCost = selectedOption ? selectedOption.total : 0;
  return {
    fulfillmentOptions,
    selectedOptionId: selectedOption?.id,
    totals: [
      {
        type: 'items_base_amount',
        display_text: 'Items Subtotal',
        amount: itemsBaseAmount,
      },
      {
        type: 'fulfillment',
        display_text: 'Shipping',
        amount: fulfillmentCost,
      },
      {
        type: 'total',
        display_text: 'Total Due',
        amount: itemsBaseAmount + fulfillmentCost,
      },
    ],
  };
}
