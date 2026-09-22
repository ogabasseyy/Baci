import { describe, expect, it } from 'vitest';
import {
  getOllamaAgenticChatTools,
  ollamaAgenticChatTools,
} from '@/app/api/chat/ollama-chat-tools';

describe('ollama chat tools', () => {
  it('exposes only server-verifiable commerce capabilities', () => {
    expect(ollamaAgenticChatTools.map((tool) => tool.function.name)).toEqual([
      'searchProducts',
      'getProductDetails',
      'createVirtualAccount',
      'checkPaymentStatus',
      'getRecommendations',
      'cancelOrder',
    ]);
  });

  it('marks product search and checkout tools with required parameters', () => {
    const searchTool = ollamaAgenticChatTools.find(
      (tool) => tool.function.name === 'searchProducts'
    );
    const accountTool = ollamaAgenticChatTools.find(
      (tool) => tool.function.name === 'createVirtualAccount'
    );

    expect(searchTool?.function.parameters).toMatchObject({
      required: ['query'],
      properties: {
        query: { type: 'string' },
        maxPrice: { type: 'number' },
      },
    });
    expect(accountTool?.function.parameters).toMatchObject({
      required: ['amount', 'customerEmail', 'customerName', 'items'],
      properties: {
        items: {
          type: 'array',
          items: {
            required: ['productId', 'name', 'price', 'quantity'],
          },
        },
      },
    });
  });

  it('tells Ollama that payment status needs an order id or email', () => {
    const paymentTool = ollamaAgenticChatTools.find(
      (tool) => tool.function.name === 'checkPaymentStatus'
    );

    expect(paymentTool?.function.description).toContain(
      'either orderId or customerEmail'
    );
    expect(paymentTool?.function.parameters).toMatchObject({
      anyOf: [{ required: ['orderId'] }, { required: ['customerEmail'] }],
      properties: {
        orderId: { type: 'string' },
        customerEmail: { type: 'string' },
      },
    });
  });

  it('tells Ollama that order cancellation needs an order reference and email', () => {
    const cancelTool = ollamaAgenticChatTools.find(
      (tool) => tool.function.name === 'cancelOrder'
    );

    expect(cancelTool?.function.description).toContain(
      'orderId or orderNumber'
    );
    expect(cancelTool?.function.description).toContain('customerEmail');
    expect(cancelTool?.function.parameters).toMatchObject({
      required: ['customerEmail'],
      anyOf: [{ required: ['orderId'] }, { required: ['orderNumber'] }],
      properties: {
        orderId: { type: 'string' },
        orderNumber: { type: 'string' },
        customerEmail: { type: 'string' },
      },
    });
  });

  it('returns the full tool set when agentic checkout is enabled', () => {
    expect(getOllamaAgenticChatTools(true)).toBe(ollamaAgenticChatTools);
  });

  it('filters commerce tools when agentic checkout is disabled', () => {
    expect(
      getOllamaAgenticChatTools(false).map((tool) => tool.function.name)
    ).toEqual([
      'searchProducts',
      'getProductDetails',
      'checkPaymentStatus',
      'getRecommendations',
    ]);
  });
});
