import type { SupabaseClient } from '@supabase/supabase-js';
import { calculateAgenticLineTax, roundAgenticCents } from './agentic-line-tax';
import type { GPTLineItem, GPTTotal } from './checkout';
import type { AgenticProduct, AgenticVariant } from './checkout-catalog';

export async function addCheckoutSessionTax({
  fulfillmentTotals,
  lineItems,
  products,
  supabase,
  variants,
  merchantId,
}: {
  fulfillmentTotals: GPTTotal[];
  lineItems: GPTLineItem[];
  products: AgenticProduct[];
  supabase: SupabaseClient;
  variants: AgenticVariant[];
  merchantId: string;
}): Promise<{ lineItems: GPTLineItem[]; totals: GPTTotal[] }> {
  let vatRegistered = false;
  if (lineItems.length > 0) {
    const { data: merchant, error } = await supabase
      .from('merchants')
      .select('vat_registration_status')
      .eq('id', merchantId)
      .maybeSingle();
    if (error) throw new Error('Failed to load checkout VAT status');
    vatRegistered = merchant?.vat_registration_status === 'registered';
  }

  const productById = new Map(products.map((product) => [product.id, product]));
  for (const variant of variants) {
    if (variant.product) {
      productById.set(variant.product_id, {
        id: variant.product_id,
        name: variant.product.name,
        price: variant.product.price ?? 0,
        vat_category_code: variant.product.vat_category_code,
        vat_rate: variant.product.vat_rate,
        stock: 0,
      });
    }
  }

  let taxAmount = 0;
  const taxedLineItems = lineItems.map((line) => {
    const product = productById.get(line.item.product_id);
    const tax = calculateAgenticLineTax({
      price: line.base_amount / line.item.quantity,
      quantity: line.item.quantity,
      vatCategoryCode: product?.vat_category_code,
      vatRate: product?.vat_rate,
      vatRegistered,
      productId: product?.id,
    });
    taxAmount += tax;
    return { ...line, tax, total: line.subtotal + tax };
  });
  taxAmount = roundAgenticCents(taxAmount);

  const shippingAmount = Number(
    fulfillmentTotals.find((total) => total.type === 'fulfillment')?.amount ?? 0
  );
  const itemsAmount = Number(
    fulfillmentTotals.find((total) => total.type === 'items_base_amount')
      ?.amount ?? 0
  );
  const totalAmount = roundAgenticCents(
    itemsAmount + shippingAmount + taxAmount
  );
  const totals = fulfillmentTotals.flatMap((total) =>
    total.type === 'total'
      ? [
          { type: 'tax' as const, display_text: 'Tax', amount: taxAmount },
          { ...total, amount: totalAmount },
        ]
      : [total]
  );

  return { lineItems: taxedLineItems, totals };
}
