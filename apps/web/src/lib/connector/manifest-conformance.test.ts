import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import {
  CONNECTOR_MANIFEST,
  type ConnectorToolDefinition,
} from '@/lib/connector/manifest';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '44444444-4444-4444-a444-444444444444';
const ORDER_ID = '66666666-6666-6666-8666-666666666666';

function ajvFor(tool: ConnectorToolDefinition) {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  return ajv.compile(tool.inputSchema);
}

describe('connector manifest JSON Schema conformance (draft 2020-12)', () => {
  it('compiles every exported inputSchema in strict mode', () => {
    expect(CONNECTOR_MANIFEST.length).toBeGreaterThan(0);
    for (const tool of CONNECTOR_MANIFEST) {
      expect(() => ajvFor(tool)).not.toThrow();
    }
  });

  it('keeps required fields, descriptions, and closed shapes', () => {
    for (const tool of CONNECTOR_MANIFEST) {
      const keys = Object.keys(tool.inputSchema.properties);
      for (const name of tool.inputSchema.required) {
        expect(keys).toContain(name);
      }
      for (const property of Object.values(tool.inputSchema.properties)) {
        expect(property.description.length).toBeGreaterThan(0);
      }
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  it('accepts valid selector payloads', () => {
    const cases: Array<{ name: string; payload: Record<string, unknown> }> = [
      {
        name: 'orders.list',
        payload: {
          merchant_id: MERCHANT_ID,
          branch_ids: [BRANCH_ID],
          limit: 20,
        },
      },
      {
        name: 'orders.get',
        payload: { merchant_id: MERCHANT_ID, order_id: ORDER_ID },
      },
      {
        name: 'inventory.levels',
        payload: { branch_ids: [] },
      },
      {
        name: 'analytics.summary',
        payload: {},
      },
    ];
    for (const { name, payload } of cases) {
      const tool = CONNECTOR_MANIFEST.find((entry) => entry.name === name);
      expect(tool).toBeDefined();
      if (!tool) continue;
      const validate = ajvFor(tool);
      expect(validate(payload)).toBe(true);
    }
  });

  it('rejects malformed branch selectors and unknown fields', () => {
    const tool = CONNECTOR_MANIFEST.find(
      (entry) => entry.name === 'orders.list'
    );
    expect(tool).toBeDefined();
    if (!tool) return;
    const validate = ajvFor(tool);

    expect(validate({ branch_ids: 'not-an-array' })).toBe(false);
    expect(validate({ branch_ids: ['not-a-uuid'] })).toBe(false);
    expect(validate({ branch_ids: [BRANCH_ID], unknown: 1 })).toBe(false);
    expect(validate({ merchant_id: 'not-a-uuid' })).toBe(false);
  });

  it('enforces orders.get required fields and list limits', () => {
    const getTool = CONNECTOR_MANIFEST.find(
      (entry) => entry.name === 'orders.get'
    );
    const listTool = CONNECTOR_MANIFEST.find(
      (entry) => entry.name === 'orders.list'
    );
    const levelsTool = CONNECTOR_MANIFEST.find(
      (entry) => entry.name === 'inventory.levels'
    );
    expect(getTool).toBeDefined();
    expect(listTool).toBeDefined();
    expect(levelsTool).toBeDefined();
    if (!getTool || !listTool || !levelsTool) return;

    expect(ajvFor(getTool)({})).toBe(false);
    expect(ajvFor(getTool)({ order_id: 'not-a-uuid' })).toBe(false);
    expect(ajvFor(listTool)({ limit: 0 })).toBe(false);
    expect(ajvFor(listTool)({ limit: 51 })).toBe(false);
    expect(ajvFor(listTool)({ limit: 1.5 })).toBe(false);
    expect(ajvFor(levelsTool)({ limit: 20 })).toBe(true);
    expect(ajvFor(levelsTool)({ limit: 0 })).toBe(false);
    expect(ajvFor(levelsTool)({ limit: 51 })).toBe(false);
  });
  it('bounds and deduplicates branch selectors for every scoped read', () => {
    for (const tool of CONNECTOR_MANIFEST.filter(
      (entry) => entry.inputSchema.properties.branch_ids
    )) {
      const validate = ajvFor(tool);
      expect(
        validate({
          branch_ids: Array.from(
            { length: 201 },
            (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
          ),
        })
      ).toBe(false);
      expect(validate({ branch_ids: [BRANCH_ID, BRANCH_ID] })).toBe(false);
      expect(validate({ branch_ids: [BRANCH_ID] })).toBe(true);
    }
  });
});
