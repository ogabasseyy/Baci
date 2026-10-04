import { describe, expect, it } from 'vitest';
import {
  CONNECTOR_MANIFEST,
  CONNECTOR_MANIFEST_VERSION,
  CONNECTOR_TOOL_NAMES,
  getConnectorTool,
  isConnectorToolName,
} from '@/lib/connector/manifest';

describe('connector manifest (R0 stability)', () => {
  it('pins the manifest version and exactly four read-only tools', () => {
    expect(CONNECTOR_MANIFEST_VERSION).toBe('r0.3');
    expect(CONNECTOR_TOOL_NAMES).toEqual([
      'orders.list',
      'orders.get',
      'inventory.levels',
      'analytics.summary',
    ]);
    expect(CONNECTOR_MANIFEST.map((tool) => tool.name)).toEqual([
      'orders.list',
      'orders.get',
      'inventory.levels',
      'analytics.summary',
    ]);
  });

  it('binds every tool to its read scope', () => {
    expect(
      CONNECTOR_MANIFEST.map((tool) => [tool.name, tool.requiredScope])
    ).toEqual([
      ['orders.list', 'orders:read'],
      ['orders.get', 'orders:read'],
      ['inventory.levels', 'inventory:read'],
      ['analytics.summary', 'analytics:read'],
    ]);
  });

  it('requires order_id for orders.get and keeps selectors optional elsewhere', () => {
    expect(getConnectorTool('orders.get')?.inputSchema.required).toEqual([
      'order_id',
    ]);
    for (const name of [
      'orders.list',
      'inventory.levels',
      'analytics.summary',
    ] as const) {
      expect(getConnectorTool(name)?.inputSchema.required).toEqual([]);
      expect(getConnectorTool(name)?.inputSchema.additionalProperties).toBe(
        false
      );
    }
  });

  it('rejects unknown tool names', () => {
    expect(isConnectorToolName('orders.list')).toBe(true);
    expect(isConnectorToolName('orders.cancel')).toBe(false);
    expect(getConnectorTool('orders.cancel')).toBeUndefined();
  });
});
