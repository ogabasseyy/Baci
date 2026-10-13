import { NextResponse } from 'next/server';
import { buildCheckoutCompleteRequestSchema } from '@/app/openapi.json/checkout-complete-request-schema';
import { AGENTIC_PAYMENT_DISCOVERY_NO_STORE_HEADERS } from '@/config/agentic-payment-discovery-cache';
import { isAgenticPaystackDvaPaused } from '@/lib/agentic/agentic-paystack-dva-paused';
import { checkoutCompletePaymentInfo } from '@/lib/agentic/mpp-checkout-payment-info';
import { buildRequestBaseUrl } from '@/lib/storefront-host';

function buildOpenApiDocument(baseUrl: string) {
  const paystackDvaPaused = isAgenticPaystackDvaPaused();

  return {
    openapi: '3.1.0',
    info: {
      title: 'Ogabassey Agentic Commerce API',
      version: '2026-04-30',
      description:
        'Machine-readable description of Ogabassey catalog, checkout, and order routes for approved agents.',
    },
    servers: [{ url: baseUrl }],
    paths: {
      '/api/agentic/catalog/search': {
        post: {
          operationId: 'searchCatalog',
          summary: 'Search the Ogabassey catalog',
          security: [{ agenticBearerHmac: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CatalogSearchRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Catalog search results',
              content: {
                'application/json': {
                  schema: { type: 'object', additionalProperties: true },
                },
              },
            },
          },
        },
      },
      '/api/agentic/catalog/lookup': {
        post: {
          operationId: 'lookupCatalog',
          summary: 'Fetch multiple catalog products by ID',
          security: [{ agenticBearerHmac: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CatalogLookupRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Catalog products',
              content: {
                'application/json': {
                  schema: { type: 'object', additionalProperties: true },
                },
              },
            },
          },
        },
      },
      '/api/agentic/catalog/product': {
        post: {
          operationId: 'getCatalogProduct',
          summary: 'Fetch a product and its selected variants',
          security: [{ agenticBearerHmac: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CatalogProductRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Product details',
              content: {
                'application/json': {
                  schema: { type: 'object', additionalProperties: true },
                },
              },
            },
          },
        },
      },
      '/api/agentic/checkout-sessions': {
        post: {
          operationId: 'createCheckoutSession',
          summary: 'Create a signed checkout session',
          security: [{ agenticBearerHmac: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CheckoutSessionRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Checkout session',
              content: {
                'application/json': {
                  schema: { type: 'object', additionalProperties: true },
                },
              },
            },
          },
        },
      },
      '/api/agentic/checkout-sessions/{id}': {
        get: {
          operationId: 'getCheckoutSession',
          summary: 'Read a signed checkout session',
          security: [{ agenticBearerHmac: [] }],
          parameters: [{ $ref: '#/components/parameters/SessionId' }],
          responses: {
            '200': {
              description: 'Checkout session',
              content: {
                'application/json': {
                  schema: { type: 'object', additionalProperties: true },
                },
              },
            },
          },
        },
        patch: {
          operationId: 'updateCheckoutSession',
          summary: 'Update a signed checkout session',
          security: [{ agenticBearerHmac: [] }],
          parameters: [{ $ref: '#/components/parameters/SessionId' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CheckoutSessionRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Updated checkout session',
            },
          },
        },
      },
      '/api/agentic/checkout-sessions/{id}/complete': {
        post: {
          operationId: 'completeCheckoutSession',
          summary:
            'Complete a signed checkout session and receive payment instructions',
          security: [{ agenticBearerHmac: [] }],
          parameters: [{ $ref: '#/components/parameters/SessionId' }],
          ...(paystackDvaPaused
            ? {}
            : { 'x-payment-info': checkoutCompletePaymentInfo }),
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/CheckoutCompleteRequest',
                },
              },
            },
          },
          responses: {
            '200': {
              description: paystackDvaPaused
                ? 'Order and machine-readable payment instructions'
                : 'Order and machine-readable Paystack bank transfer instructions',
              content: {
                'application/json': {
                  schema: { type: 'object', additionalProperties: true },
                },
              },
            },
            '402': {
              description: 'Payment Required',
            },
            '409': {
              description:
                'Recoverable checkout conflict that requires user resolution or retry',
            },
            '428': {
              description: 'Missing or invalid user confirmation',
            },
          },
        },
      },
      '/api/agentic/orders/{id}': {
        get: {
          operationId: 'getOrder',
          summary: 'Read an order by ID',
          security: [{ agenticBearerHmac: [] }],
          parameters: [{ $ref: '#/components/parameters/OrderId' }],
          responses: {
            '200': {
              description: 'Order details',
              content: {
                'application/json': {
                  schema: { type: 'object', additionalProperties: true },
                },
              },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        agenticBearerHmac: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Bearer token plus HMAC request-signing headers described in /agent-commerce.json.',
        },
      },
      parameters: {
        SessionId: {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
        OrderId: {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      },
      schemas: {
        CatalogSearchRequest: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            pagination: { type: 'object', additionalProperties: true },
          },
        },
        CatalogLookupRequest: {
          type: 'object',
          properties: {
            ids: {
              type: 'array',
              minItems: 1,
              maxItems: 50,
              items: { type: 'string' },
            },
            filters: { type: 'object', additionalProperties: true },
          },
          required: ['ids'],
        },
        CatalogProductRequest: {
          type: 'object',
          properties: {
            product_id: { type: 'string' },
            selected: {
              type: 'array',
              items: { type: 'object', additionalProperties: true },
            },
          },
        },
        CheckoutSessionRequest: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  product_id: { type: 'string' },
                  quantity: { type: 'integer', minimum: 1 },
                },
                required: ['product_id', 'quantity'],
              },
            },
            shipping_address: {
              type: 'object',
              additionalProperties: true,
            },
          },
          required: ['items'],
        },
        CheckoutCompleteRequest:
          buildCheckoutCompleteRequestSchema(paystackDvaPaused),
      },
    },
  };
}

export function GET(request: Request): NextResponse {
  return NextResponse.json(buildOpenApiDocument(buildRequestBaseUrl(request)), {
    headers: AGENTIC_PAYMENT_DISCOVERY_NO_STORE_HEADERS,
  });
}
