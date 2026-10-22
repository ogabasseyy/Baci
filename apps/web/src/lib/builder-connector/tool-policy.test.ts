import { expect, it } from 'vitest';
import { z } from 'zod';
import { builderInputSchemas } from '@/schemas/builder-mcp';
import { builderOutputSchemas } from '@/schemas/builder-mcp-results';
import { builderError } from './errors';
import { builderAuthChallenge, builderToolPolicy } from './tool-policy';

it('serializes standalone MCP schemas with semantic string inputs', () => {
  for (const name of Object.keys(
    builderInputSchemas
  ) as (keyof typeof builderInputSchemas)[]) {
    const schema = z.toJSONSchema(builderInputSchemas[name], { io: 'input' });
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(() => z.toJSONSchema(builderOutputSchemas[name])).not.toThrow();
  }
  const create = z.toJSONSchema(builderInputSchemas.create_storefront_draft, {
    io: 'input',
  });
  expect(create.properties?.businessName).toMatchObject({
    type: 'string',
    minLength: 2,
    maxLength: 200,
  });
  expect(create.properties?.businessType).toHaveProperty('enum');
});
it('keeps every policy scope and challenge aligned with the operation', () => {
  for (const [name, policy] of Object.entries(builderToolPolicy)) {
    expect(policy.securitySchemes).toEqual([
      { type: 'oauth2', scopes: policy.scopes },
    ]);
    const challenge = builderAuthChallenge(
      'CONNECTION_REVOKED',
      name as keyof typeof builderToolPolicy
    );
    expect(challenge._meta['mcp/www_authenticate'][0]).toContain(
      'error="invalid_token"'
    );
    expect(policy.scopes).toContain('storefront.read');
  }
});
it('exposes only fixed public error messages', () => {
  expect(builderError('OPERATION_FAILED')).toEqual({
    status: 'error',
    code: 'OPERATION_FAILED',
    error:
      'The operation could not be completed. Read its status before retrying.',
  });
  expect(JSON.stringify(builderError('CONNECTION_REVOKED'))).not.toContain(
    'token'
  );
});
it('includes revision recovery and a trusted native editor link in matching errors', () => {
  expect(builderError('STALE_DRAFT', 'opaque:0001')).toMatchObject({
    currentVersion: 'opaque:0001',
  });
  expect(
    builderOutputSchemas.update_storefront_draft.safeParse(
      builderError('STALE_DRAFT', 'opaque:0001')
    ).success
  ).toBe(true);
  expect(builderError('UNSUPPORTED_TEMPLATE')).toMatchObject({
    editorUrl: 'https://usebaci.com/builder',
  });
  expect(
    builderOutputSchemas.preview_storefront.safeParse(
      builderError('UNSUPPORTED_TEMPLATE')
    ).success
  ).toBe(true);
});
