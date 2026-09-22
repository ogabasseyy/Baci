import { TOOL_DESCRIPTIONS } from '@/ai/chat-tools';
import type { OllamaChatTool } from '@/lib/ollama-chat';

const CHECKOUT_TOOL_NAMES = new Set(['createVirtualAccount', 'cancelOrder']);

const STRING_SCHEMA = { type: 'string' } as const;
const NUMBER_SCHEMA = { type: 'number' } as const;

export const ollamaAgenticChatTools: OllamaChatTool[] = [
  {
    type: 'function',
    function: {
      name: 'searchProducts',
      description: TOOL_DESCRIPTIONS.searchProducts,
      parameters: {
        type: 'object',
        required: ['query'],
        properties: {
          query: {
            ...STRING_SCHEMA,
            description:
              'Search query for products, for example iPhone 15 or gaming laptop',
          },
          category: { ...STRING_SCHEMA, description: 'Optional category' },
          maxPrice: { ...NUMBER_SCHEMA, description: 'Maximum price in Naira' },
          minPrice: { ...NUMBER_SCHEMA, description: 'Minimum price in Naira' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getProductDetails',
      description: TOOL_DESCRIPTIONS.getProductDetails,
      parameters: {
        type: 'object',
        required: ['productId'],
        properties: {
          productId: {
            ...STRING_SCHEMA,
            description: 'The unique ID of the product',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createVirtualAccount',
      description: TOOL_DESCRIPTIONS.createVirtualAccount,
      parameters: {
        type: 'object',
        required: ['amount', 'customerEmail', 'customerName', 'items'],
        properties: {
          amount: { ...NUMBER_SCHEMA, description: 'Total amount in Naira' },
          customerEmail: {
            ...STRING_SCHEMA,
            description: 'Customer email address',
          },
          customerName: {
            ...STRING_SCHEMA,
            description: 'Customer full name',
          },
          customerPhone: {
            ...STRING_SCHEMA,
            description: 'Optional customer phone number',
          },
          items: {
            type: 'array',
            description: 'Items being purchased',
            items: {
              type: 'object',
              required: ['productId', 'name', 'price', 'quantity'],
              properties: {
                productId: STRING_SCHEMA,
                name: STRING_SCHEMA,
                price: NUMBER_SCHEMA,
                quantity: NUMBER_SCHEMA,
              },
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'checkPaymentStatus',
      description: `${TOOL_DESCRIPTIONS.checkPaymentStatus} Provide either orderId or customerEmail.`,
      parameters: {
        type: 'object',
        anyOf: [{ required: ['orderId'] }, { required: ['customerEmail'] }],
        properties: {
          orderId: { ...STRING_SCHEMA, description: 'The chat order ID' },
          customerEmail: {
            ...STRING_SCHEMA,
            description: 'Customer email for recent payment lookup',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getRecommendations',
      description: TOOL_DESCRIPTIONS.getRecommendations,
      parameters: {
        type: 'object',
        required: ['productId', 'type'],
        properties: {
          productId: {
            ...STRING_SCHEMA,
            description: 'Product ID to get recommendations for',
          },
          type: {
            type: 'string',
            enum: ['upsell', 'cross_sell', 'accessories'],
            description: 'Recommendation type',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancelOrder',
      description: `${TOOL_DESCRIPTIONS.cancelOrder} Provide either orderId or orderNumber, and always provide customerEmail.`,
      parameters: {
        type: 'object',
        required: ['customerEmail'],
        anyOf: [{ required: ['orderId'] }, { required: ['orderNumber'] }],
        properties: {
          orderId: { ...STRING_SCHEMA, description: 'The Baci order UUID' },
          orderNumber: {
            ...STRING_SCHEMA,
            description: 'The customer-facing order number',
          },
          customerEmail: {
            ...STRING_SCHEMA,
            description: 'Customer email address on the order',
          },
        },
      },
    },
  },
];

export function getOllamaAgenticChatTools(
  agenticCheckoutEnabled: boolean
): OllamaChatTool[] {
  if (agenticCheckoutEnabled) {
    return ollamaAgenticChatTools;
  }

  return ollamaAgenticChatTools.filter(
    (tool) => !CHECKOUT_TOOL_NAMES.has(tool.function.name)
  );
}
