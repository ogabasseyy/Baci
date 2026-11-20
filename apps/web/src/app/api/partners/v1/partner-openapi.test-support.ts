import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { expect } from 'vitest';
import { parse } from 'yaml';

type ApiDocument = {
  paths: Record<
    string,
    Record<string, { responses: Record<number, { $ref?: string }> }>
  >;
};

const contract = parse(
  readFileSync(
    new URL(
      '../../../../../../../docs/partners/delivery-api.openapi.yaml',
      import.meta.url
    ),
    'utf8'
  )
) as ApiDocument;
const schemaId = 'https://example.invalid/baci-partner-openapi';
const validator = new Ajv2020({ strict: false });
addFormats(validator);
validator.addSchema({ ...contract, $id: schemaId });

export function expectPartnerResponse(
  operation: `${'GET' | 'POST'} /${string}`,
  status: number,
  body: unknown
) {
  const separator = operation.indexOf(' ');
  const method = operation.slice(0, separator).toLowerCase();
  const path = operation.slice(separator + 1);
  const pathPointer = path.replaceAll('~', '~0').replaceAll('/', '~1');
  const response = contract.paths[path]?.[method]?.responses[status];
  if (!response)
    throw new Error(`Undocumented response for ${operation} ${status}`);
  const responsePointer =
    response.$ref ?? `#/paths/${pathPointer}/${method}/responses/${status}`;
  const validate = validator.getSchema(
    `${schemaId}${responsePointer}/content/application~1json/schema`
  );
  if (!validate) throw new Error(`Missing schema for ${operation} ${status}`);
  expect(validate(body), validator.errorsText(validate.errors)).toBe(true);
}
