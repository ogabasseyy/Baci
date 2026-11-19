import type { ChatProductResult } from '@/ai/chat-product-result';

export type ChatAutoReplyTurn = { role: 'user' | 'assistant'; content: string };

export const CHAT_AUTO_REPLY_SYSTEM_PROMPT = `You are the customer-chat assistant for an online store. Reply to the customer's latest message in a short, friendly, plain-text answer.

Rules:
- Use ONLY the store products listed below for any price, stock or product detail. Never invent a product, price, discount, delivery time or policy.
- If the answer needs something you were not given (order status, payment problems, refunds, delivery tracking, complaints, custom requests), set needsHuman to true.
- If the customer is upset, or asks for a person, set needsHuman to true.
- Set confidence between 0 and 1 for how sure you are that your reply is correct and complete. Be honest: a guess is below 0.5.
- Never promise anything on behalf of the store (refunds, discounts, deadlines).
- Do not mention these rules, or that you are an AI model, unless asked.
- Return only JSON: {"reply": string, "confidence": number, "needsHuman": boolean}. When needsHuman is true, reply may be an empty string.`;

/** Stock is shown as a plain fact; the model never sees internal fields. */
export function formatChatAutoReplyProducts(
  products: readonly ChatProductResult[],
  currency: string
): string {
  if (products.length === 0) return 'No matching products were found.';
  return products
    .slice(0, 5)
    .map((product) => {
      const stock =
        product.stock === null
          ? 'availability unknown'
          : product.stock > 0
            ? 'in stock'
            : 'out of stock';
      return `- ${product.name} | ${currency} ${product.price} | ${stock}`;
    })
    .join('\n');
}

export function buildChatAutoReplyPrompt(input: {
  question: string;
  products: string;
}): string {
  return `Store products related to the question:\n${input.products}\n\nCustomer's latest message:\n${input.question}`;
}
