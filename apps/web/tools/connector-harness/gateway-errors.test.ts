// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { pgErrorToHttp, pgRaiseToHttp } from './gateway';

describe('pgRaiseToHttp', () => {
  it('maps denial raises to safe coded responses', () => {
    expect(pgRaiseToHttp('connector_grant_invalid')).toEqual({
      status: 401,
      body: {
        error: 'Connector access is invalid, revoked, or expired.',
        code: 'GRANT_REVOKED',
      },
    });
    expect(pgRaiseToHttp('connector_grant_denied').status).toBe(401);
    expect(pgRaiseToHttp('connector_grant_forbidden')).toMatchObject({
      status: 403,
    });
    expect(pgRaiseToHttp('connector_scope_denied').body.code).toBe(
      'FORBIDDEN_SCOPE'
    );
    expect(pgRaiseToHttp('connector_branch_denied').body.code).toBe(
      'BRANCH_NOT_ALLOWED'
    );
  });

  it('maps issuance validation failures without leaking internals', () => {
    expect(pgRaiseToHttp('invalid_connector_grant_scope').status).toBe(403);
    expect(pgRaiseToHttp('invalid_connector_grant_token').status).toBe(400);
    expect(pgRaiseToHttp('invalid_connector_grant_token').body.code).toBe(
      'INVALID_REQUEST'
    );
    expect(
      pgRaiseToHttp('invalid_connector_grant_token').body.error
    ).not.toContain('token_hash');
  });

  it('fails closed on unknown errors', () => {
    expect(pgRaiseToHttp('syntax error at end of input')).toEqual({
      status: 500,
      body: { error: 'Connector request failed.', code: 'UNKNOWN_OUTCOME' },
    });
    expect(pgErrorToHttp(new Error('connector_branch_denied')).status).toBe(
      403
    );
    expect(pgErrorToHttp(null).status).toBe(500);
    expect(pgErrorToHttp('plain string').status).toBe(500);
  });
});
