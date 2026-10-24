// @vitest-environment node
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { implementedBuilderTools } from '../../src/schemas/builder-implemented-tools';
import { builderInputSchemas } from '../../src/schemas/builder-mcp';
import { builderOutputSchemas } from '../../src/schemas/builder-mcp-results';
import { builderToolNames } from '../../src/schemas/builder-tool-names';

function normalizeWireSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeWireSchema);
  if (!value || typeof value !== 'object') return value;

  const record = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      normalizeWireSchema(child),
    ])
  );
  const prefixItems = record.prefixItems;
  // Keep required Zod tuples exact when JSON conversion omits tuple bounds.
  if (
    Array.isArray(prefixItems) &&
    record.items === undefined &&
    record.maxItems === undefined &&
    record.minItems === undefined
  ) {
    return {
      ...record,
      items: false,
      maxItems: prefixItems.length,
      minItems: prefixItems.length,
    };
  }
  return record;
}

it('keeps fixed tuple schemas closed in the generated wire contract', () => {
  expect(normalizeWireSchema({ prefixItems: [{ type: 'string' }] })).toEqual({
    items: false,
    maxItems: 1,
    minItems: 1,
    prefixItems: [{ type: 'string' }],
  });
});

it('preserves explicit tuple bounds in generated wire schemas', () => {
  expect(
    normalizeWireSchema({
      maxItems: 2,
      minItems: 0,
      prefixItems: [{ type: 'string' }],
    })
  ).toEqual({
    maxItems: 2,
    minItems: 0,
    prefixItems: [{ type: 'string' }],
  });
});

it('keeps the generated adapter wire contracts identical to canonical web schemas', () => {
  const snapshot = {
    inputs: Object.fromEntries(
      implementedBuilderTools.map((n) => [
        n,
        normalizeWireSchema(
          z.toJSONSchema(builderInputSchemas[n], { io: 'input' })
        ),
      ])
    ),
    outputs: Object.fromEntries(
      implementedBuilderTools.map((n) => [
        n,
        normalizeWireSchema(z.toJSONSchema(builderOutputSchemas[n])),
      ])
    ),
  };
  const file = path.resolve('builder-mcp-server/contracts.json');
  if (process.env.BACI_GENERATE_BUILDER_CONTRACTS === '1')
    writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(snapshot);
  expect(Object.keys(builderInputSchemas)).toEqual([...builderToolNames]);
});
