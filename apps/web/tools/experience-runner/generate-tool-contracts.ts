import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { experienceToolResult } from '../../src/schemas/experience-tool-results';
import { experienceToolInputs } from '../../src/schemas/experience-tools';
export function experienceWireContracts() {
  return {
    inputs: Object.fromEntries(
      Object.entries(experienceToolInputs).map(([n, s]) => [
        n,
        {
          ...z.toJSONSchema(s, { unrepresentable: 'any', io: 'input' }),
          type: 'object',
        },
      ])
    ),
    output: {
      ...z.toJSONSchema(experienceToolResult, { io: 'input' }),
      type: 'object',
    },
  };
}
export function generateExperienceContracts(check = false) {
  const path = new URL(
    '../../builder-mcp-server/experience-contracts.json',
    import.meta.url
  );
  const output = `${JSON.stringify(experienceWireContracts(), null, 2)}\n`;
  if (check) {
    if (
      JSON.stringify(JSON.parse(readFileSync(path, 'utf8'))) !==
      JSON.stringify(experienceWireContracts())
    )
      throw Error('Experience contracts drift');
  } else writeFileSync(path, output);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  generateExperienceContracts(process.argv.includes('--check'));
