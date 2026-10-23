// @vitest-environment node
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { implementedBuilderTools } from '../../src/schemas/builder-implemented-tools';
import { builderInputSchemas } from '../../src/schemas/builder-mcp';
import { builderOutputSchemas } from '../../src/schemas/builder-mcp-results';
import { builderToolNames } from '../../src/schemas/builder-tool-names';

it('keeps the generated adapter wire contracts identical to canonical web schemas', () => {
  const snapshot = {
    inputs: Object.fromEntries(
      implementedBuilderTools.map((n) => [
        n,
        z.toJSONSchema(builderInputSchemas[n], { io: 'input' }),
      ])
    ),
    outputs: Object.fromEntries(
      implementedBuilderTools.map((n) => [
        n,
        z.toJSONSchema(builderOutputSchemas[n]),
      ])
    ),
  };
  const file = path.resolve('builder-mcp-server/contracts.json');
  if (process.env.BACI_GENERATE_BUILDER_CONTRACTS === '1')
    writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(snapshot);
  expect(Object.keys(builderInputSchemas)).toEqual([...builderToolNames]);
});
