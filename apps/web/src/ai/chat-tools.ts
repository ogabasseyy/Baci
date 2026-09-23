/**
 * AI Chat Tools for Agentic Commerce
 *
 * Provides Zod schemas and descriptions for function-calling with Gemini.
 * These tools enable the chatbot to:
 * - Search and retrieve products
 * - Generate virtual bank accounts for payment
 * - Check payment status
 * - Cancel unpaid, unfulfilled orders
 * - Get upsell/cross-sell recommendations
 */

import z from 'zod';

// ============================================
// TOOL SCHEMAS (Zod)
// ============================================

export const searchProductsSchema = z.object({
  query: z
    .string()
    .describe('Search query for products (e.g., "iPhone 15", "gaming laptop")'),
  category: z.string().optional().describe('Optional category filter'),
  maxPrice: z.number().optional().describe('Maximum price in Naira'),
  minPrice: z.number().optional().describe('Minimum price in Naira'),
});

export const getProductDetailsSchema = z.object({
  productId: z.string().describe('The unique ID of the product'),
});

export const createVirtualAccountSchema = z.object({
  amount: z.number().describe('Total amount to pay in Naira'),
  customerEmail: z.email().describe('Customer email address'),
  customerName: z.string().describe('Customer full name'),
  customerPhone: z.string().optional().describe('Customer phone number'),
  items: z
    .array(
      z.object({
        productId: z.string(),
        name: z.string(),
        price: z.number(),
        quantity: z.number(),
      })
    )
    .describe('Items being purchased'),
});

export const checkPaymentStatusSchema = z
  .object({
    orderId: z
      .string()
      .optional()
      .describe('The chat order ID to check payment status for'),
    customerEmail: z
      .string()
      .email()
      .optional()
      .describe('Customer email to look up their most recent payment'),
  })
  .refine((data) => data.orderId || data.customerEmail, {
    message: 'Either orderId or customerEmail is required',
  });

export const cancelOrderSchema = z
  .object({
    orderId: z
      .string()
      .trim()
      .uuid()
      .optional()
      .describe('The Baci order UUID to cancel'),
    orderNumber: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .optional()
      .describe('The customer-facing order number to cancel'),
    customerEmail: z
      .string()
      .trim()
      .email()
      .transform((value) => value.toLowerCase())
      .describe('Customer email address on the order'),
  })
  .refine((data) => data.orderId || data.orderNumber, {
    message: 'Either orderId or orderNumber is required',
  });

export const getRecommendationsSchema = z.object({
  productId: z.string().describe('Product ID to get recommendations for'),
  type: z
    .enum(['upsell', 'cross_sell', 'accessories'])
    .describe(
      'Type of recommendation: upsell (better version), cross_sell (complementary products), accessories'
    ),
});

export const addToCartSchema = z.object({
  productId: z.string().describe('Product ID to add to cart'),
  quantity: z
    .number()
    .int()
    .min(1)
    .max(99)
    .default(1)
    .describe('Quantity to prepare for customer confirmation'),
});

// ============================================
// TOOL DESCRIPTIONS
// ============================================

export const TOOL_DESCRIPTIONS = {
  searchProducts:
    'Search for products matching a query. Use this when the user asks about products, availability, or prices.',
  getProductDetails:
    'Get full details for a specific product including description, specifications, stock, and images.',
  createVirtualAccount:
    'Generate a bank account number for the customer to pay via bank transfer. Use this when the customer is ready to pay.',
  checkPaymentStatus:
    'Check if payment has been received for a pending order. Use this when customer says they have paid.',
  cancelOrder:
    'Cancel an unpaid, unfulfilled customer order. Requires orderId or orderNumber plus customerEmail. If the order is paid, processing, shipped, or delivered, direct the customer to WhatsApp support instead.',
  getRecommendations:
    'Get related product recommendations. Use "upsell" for better alternatives, "cross_sell" for complementary products, "accessories" for add-ons.',
  addToCart:
    "Prepare a product card that the customer must confirm before it is added to their cart. Never claim the item was added until the customer taps the card's add button.",
} as const;

// ============================================
// TYPE EXPORTS
// ============================================

export type SearchProductsParams = z.infer<typeof searchProductsSchema>;
export type GetProductDetailsParams = z.infer<typeof getProductDetailsSchema>;
export type CreateVirtualAccountParams = z.infer<
  typeof createVirtualAccountSchema
>;
export type CheckPaymentStatusParams = z.infer<typeof checkPaymentStatusSchema>;
export type CancelOrderParams = z.infer<typeof cancelOrderSchema>;
export type GetRecommendationsParams = z.infer<typeof getRecommendationsSchema>;
export type AddToCartParams = z.infer<typeof addToCartSchema>;
