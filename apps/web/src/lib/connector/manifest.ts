/**
 * Connector tool manifest (R0 spike, data only — no routes).
 *
 * Four read-only tools for the R1 pilot. Tool names and schemas are stable
 * identifiers: renaming or reshaping a tool is a manifest version bump and a
 * re-review, because Muse tool discovery pins to these values.
 *
 * Every `inputSchema` is a standalone JSON Schema (draft 2020-12) object.
 * Conformance is enforced by `manifest-conformance.test.ts` with Ajv; do not
 * introduce shorthand property types.
 */

import type { ConnectorScope } from '@/lib/connector/grant';

export const CONNECTOR_MANIFEST_VERSION = 'r0.4';

export const CONNECTOR_INPUT_SCHEMA_DIALECT =
  'https://json-schema.org/draft/2020-12/schema';

export const CONNECTOR_TOOL_NAMES = [
  'orders.list',
  'orders.get',
  'inventory.levels',
  'analytics.summary',
] as const;

export type ConnectorToolName = (typeof CONNECTOR_TOOL_NAMES)[number];

export interface ConnectorStringProperty {
  type: 'string';
  format?: 'uuid';
  description: string;
}

export interface ConnectorStringArrayProperty {
  type: 'array';
  maxItems: number;
  uniqueItems: true;
  items: {
    type: 'string';
    format: 'uuid';
  };
  description: string;
}

export interface ConnectorIntegerProperty {
  type: 'integer';
  minimum?: number;
  maximum?: number;
  description: string;
}

export type ConnectorToolInputProperty =
  | ConnectorStringProperty
  | ConnectorStringArrayProperty
  | ConnectorIntegerProperty;

export interface ConnectorToolInputSchema {
  type: 'object';
  properties: Record<string, ConnectorToolInputProperty>;
  required: string[];
  additionalProperties: false;
}

export interface ConnectorToolDefinition {
  name: ConnectorToolName;
  description: string;
  requiredScope: ConnectorScope;
  inputSchema: ConnectorToolInputSchema;
}

function uuidSelector(description: string): ConnectorStringProperty {
  return { type: 'string', format: 'uuid', description };
}

const MERCHANT_SELECTOR = uuidSelector(
  'Resource selector only. Must equal the grant merchant; never authority.'
);
const BRANCH_SELECTOR: ConnectorStringArrayProperty = {
  type: 'array',
  maxItems: 200,
  uniqueItems: true,
  items: { type: 'string', format: 'uuid' },
  description:
    'Resource selectors only. Every id must sit inside the grant branch allowlist.',
};

export const CONNECTOR_MANIFEST: ConnectorToolDefinition[] = [
  {
    name: 'orders.list',
    description: 'List recent orders with payment and fulfillment summaries.',
    requiredScope: 'orders:read',
    inputSchema: {
      type: 'object',
      properties: {
        merchant_id: MERCHANT_SELECTOR,
        branch_ids: BRANCH_SELECTOR,
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: 'Page size, 1..50. Defaults to 20.',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'orders.get',
    description:
      'Get one order with independent payment and fulfillment dimensions.',
    requiredScope: 'orders:read',
    inputSchema: {
      type: 'object',
      properties: {
        merchant_id: MERCHANT_SELECTOR,
        order_id: uuidSelector('Order id to read.'),
      },
      required: ['order_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'inventory.levels',
    description: 'Read stock levels and low-stock signals per branch.',
    requiredScope: 'inventory:read',
    inputSchema: {
      type: 'object',
      properties: {
        merchant_id: MERCHANT_SELECTOR,
        branch_ids: BRANCH_SELECTOR,
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: 'Page size, 1..50. Defaults to 20.',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'analytics.summary',
    description:
      'Read sales and stock signals scoped to permitted branches. Aggregates never leak excluded branches.',
    requiredScope: 'analytics:read',
    inputSchema: {
      type: 'object',
      properties: {
        merchant_id: MERCHANT_SELECTOR,
        branch_ids: BRANCH_SELECTOR,
      },
      required: [],
      additionalProperties: false,
    },
  },
];

/** Scopes a new grant can use today, derived only from exposed tools. */
export const CONNECTOR_TOOL_SCOPES: [ConnectorScope, ...ConnectorScope[]] = [
  ...new Set(CONNECTOR_MANIFEST.map((tool) => tool.requiredScope)),
] as [ConnectorScope, ...ConnectorScope[]];

export function isConnectorToolName(value: string): value is ConnectorToolName {
  return (CONNECTOR_TOOL_NAMES as readonly string[]).includes(value);
}

export function getConnectorTool(
  name: string
): ConnectorToolDefinition | undefined {
  return CONNECTOR_MANIFEST.find((tool) => tool.name === name);
}
