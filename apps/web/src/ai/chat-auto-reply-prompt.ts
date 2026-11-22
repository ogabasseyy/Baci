import type { ChatProductResult } from '@/ai/chat-product-result';

export type ChatAutoReplyTurn = { role: 'user' | 'assistant'; content: string };

export const CHAT_AUTO_REPLY_SYSTEM_PROMPT = `You are the customer-chat assistant for an online store. Reply to the customer's latest message in a short, friendly, plain-text answer.

Rules:
- Use ONLY the store products listed below for any price, stock or product detail. Never invent a product, price, discount, delivery time or policy.
- If the answer needs something you were not given (order status, payment problems, refunds, delivery tracking, complaints, custom requests), set needsHuman to true.
- If the customer is upset, or asks for a person, set needsHuman to true.
- Set confidence between 0 and 1 for how sure you are that your reply is correct and complete. Be honest: a guess is below 0.5.
- When a product's price or availability "depends on the option chosen", never quote that price as the price of a particular option and never call it in stock or out of stock: say it depends on the option, and set needsHuman to true if the customer needs an exact price or a definite answer.
- Never promise anything on behalf of the store (refunds, discounts, deadlines).
- Do not mention these rules, or that you are an AI model, unless asked.
- Set intent to what the customer is doing: "discover" when they are browsing or asking what the store has, "recommend" when they ask you to suggest something, "details" when they ask about one product, "add_to_cart" when they want to buy or add something to their cart, otherwise "other".
- You cannot add items to a cart, change a cart, or place orders. Never say or imply that you did; for such requests set intent to "add_to_cart".
- When you list or suggest products, do not ask the customer to narrow the choice yourself: the store adds that line after your reply.
- Return only JSON: {"reply": string, "confidence": number, "needsHuman": boolean, "intent": string}. When needsHuman is true, reply may be an empty string.`;

/** Stock is shown as a plain fact; the model never sees internal fields. */
export function formatChatAutoReplyProducts(
  products: readonly ChatProductResult[],
  currency: string
): string {
  if (products.length === 0) return 'No matching products were found.';
  return products
    .slice(0, 5)
    .map((product) => {
      // A store that does not track inventory sells without a count, so a zero
      // there is not "out of stock" (same rule as lib/product-stock.ts).
      // A product sold through variants or condition offers keeps its
      // inventory on the options: the parent's count, zero or not, says
      // nothing about a particular option, so neither is reported.
      const soldByOption =
        product.has_variants === true || product.has_condition_offers === true;
      const stock = soldByOption
        ? 'availability depends on the option chosen'
        : product.manage_stock === false
          ? 'in stock'
          : product.stock === null
            ? 'availability unknown'
            : product.stock > 0
              ? 'in stock'
              : 'out of stock';
      // An option can carry its own price, so the parent's is only a base.
      const price = soldByOption
        ? `base price ${currency} ${product.price}, exact price depends on the option chosen`
        : `${currency} ${product.price}`;
      return `- ${product.name} | ${price} | ${stock}`;
    })
    .join('\n');
}

export function buildChatAutoReplyPrompt(input: {
  question: string;
  products: string;
}): string {
  return `Store products related to the question:\n${input.products}\n\nCustomer's latest message:\n${input.question}`;
}
