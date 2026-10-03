import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_REQUIRED_TOOLS,
  DEFAULT_REQUIRED_TOOL_SCHEMA_CONTRACTS,
  validateToolSchemaContracts,
} from './check-live-mcp-tools.mjs';

test('tracks the deployed public MCP tool inventory', () => {
  assert.deepEqual(DEFAULT_REQUIRED_TOOLS, [
    'add_to_cart',
    'browse_categories',
    'get_brands',
    'get_product',
    'get_product_variants',
    'get_delivery_fee_info',
    'get_store_info',
    'search_products',
  ]);
  assert.equal(DEFAULT_REQUIRED_TOOLS.includes('get_recommendations'), false);
  assert.equal(DEFAULT_REQUIRED_TOOLS.includes('get_shipping_quote'), false);
});

const requiredTools = [
  'create_agentic_checkout_session',
  'update_agentic_checkout_session',
];

test('accepts MCP checkout create and update input schemas', () => {
  const errors = validateToolSchemaContracts(
    [
      makeCheckoutTool('create_agentic_checkout_session', {
        properties: ['currency', 'idempotency_key', 'items', 'shipping_address'],
        required: ['items'],
      }),
      makeCheckoutTool('update_agentic_checkout_session', {
        properties: [
          'fulfillment_option_id',
          'idempotency_key',
          'items',
          'session_id',
          'shipping_address',
        ],
        required: ['session_id'],
      }),
    ],
    DEFAULT_REQUIRED_TOOL_SCHEMA_CONTRACTS,
    requiredTools
  );

  assert.deepEqual(errors, []);
});

test('rejects empty MCP checkout input schemas', () => {
  const errors = validateToolSchemaContracts(
    [
      {
        inputSchema: {
          properties: {},
          type: 'object',
        },
        name: 'create_agentic_checkout_session',
      },
      {
        inputSchema: {
          properties: {},
          type: 'object',
        },
        name: 'update_agentic_checkout_session',
      },
    ],
    DEFAULT_REQUIRED_TOOL_SCHEMA_CONTRACTS,
    requiredTools
  );

  assert.deepEqual(errors, [
    'create_agentic_checkout_session inputSchema.required missing items',
    'create_agentic_checkout_session inputSchema.properties is empty',
    'update_agentic_checkout_session inputSchema.required missing session_id',
    'update_agentic_checkout_session inputSchema.properties is empty',
  ]);
});

test('rejects missing nested MCP checkout item fields', () => {
  const errors = validateToolSchemaContracts(
    [
      {
        inputSchema: {
          properties: {
            currency: { type: 'string' },
            idempotency_key: { type: 'string' },
            items: {
              items: {
                properties: {
                  id: { type: 'string' },
                },
                type: 'object',
              },
              type: 'array',
            },
            shipping_address: { type: 'object' },
          },
          required: ['items'],
          type: 'object',
        },
        name: 'create_agentic_checkout_session',
      },
    ],
    DEFAULT_REQUIRED_TOOL_SCHEMA_CONTRACTS,
    ['create_agentic_checkout_session']
  );

  assert.deepEqual(errors, [
    'create_agentic_checkout_session inputSchema.properties.items.items.properties missing quantity',
  ]);
});

test('does not enforce schema contracts for tools outside the required set', () => {
  const errors = validateToolSchemaContracts(
    [
      {
        inputSchema: {
          properties: {},
          type: 'object',
        },
        name: 'create_agentic_checkout_session',
      },
    ],
    DEFAULT_REQUIRED_TOOL_SCHEMA_CONTRACTS,
    ['search_products']
  );

  assert.deepEqual(errors, []);
});

function makeCheckoutTool(name, { properties, required }) {
  return {
    inputSchema: {
      properties: Object.fromEntries(
        properties.map((propertyName) => [
          propertyName,
          propertyName === 'items'
            ? {
                items: {
                  properties: {
                    id: { type: 'string' },
                    quantity: { type: 'integer' },
                  },
                  required: ['id', 'quantity'],
                  type: 'object',
                },
                type: 'array',
              }
            : { type: 'string' },
        ])
      ),
      required,
      type: 'object',
    },
    name,
  };
}
