import Ajv from 'ajv';
import { expect, it } from 'vitest';
import type { HarnessSql } from '../connector-harness/gateway';
import { makeRequestContext } from './request-context.test-support';
import { handleToolRequest } from './tool-request';

it('rejects an unknown tool before reading its body or accessing the database', async () => {
  const context = makeRequestContext('/v0/tools/unknown');
  await handleToolRequest(context, 'unknown');
  expect(context.sendError).toHaveBeenCalledWith(
    context.response,
    404,
    'Unknown connector tool.',
    'INVALID_REQUEST'
  );
  expect(context.sql).not.toHaveBeenCalled();
});
it('requires a bearer credential for a known tool', async () => {
  const context = makeRequestContext('/v0/tools/orders.list');
  await handleToolRequest(context, 'orders.list');
  expect(context.sendError).toHaveBeenCalledWith(
    context.response,
    401,
    expect.any(String),
    'GRANT_REVOKED'
  );
  expect(context.sql).not.toHaveBeenCalled();
});

it('sets local query limits before resolving a grant and handles query timeout safely', async () => {
  const context = makeRequestContext('/v0/tools/orders.list');
  context.presented = 'synthetic-test-token';
  context.validators.set('orders.list', new Ajv().compile({ type: 'object' }));
  context.request.push('{}');
  context.request.push(null);
  const statements: string[] = [];
  const transaction = async (parts: TemplateStringsArray) => {
    const statement = parts.join('?');
    statements.push(statement);
    if (statement.includes('resolve_connector_grant_context')) {
      throw Object.assign(new Error('private timeout details'), {
        code: '57014',
      });
    }
    return [];
  };
  context.sql = {
    begin: async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
  } as unknown as HarnessSql;
  await handleToolRequest(context, 'orders.list');
  expect(statements[0]).toContain("statement_timeout = '5s'");
  expect(statements[1]).toContain("lock_timeout = '1s'");
  expect(statements[2]).toContain('resolve_connector_grant_context');
  expect(context.response.statusCode).toBe(500);
  expect(context.audit).toHaveBeenCalledWith(
    expect.objectContaining({ status: 500, grantId: null })
  );
});
