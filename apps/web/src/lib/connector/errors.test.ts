import { describe, expect, it } from 'vitest';
import {
  CONNECTOR_ERROR_CODES,
  connectorError,
  connectorErrorStatus,
} from './errors';

describe('connector error taxonomy', () => {
  it('builds the stable { error, code } shape', () => {
    expect(connectorError('GRANT_REVOKED', 'Denied.')).toEqual({
      error: 'Denied.',
      code: 'GRANT_REVOKED',
    });
  });

  it('maps gateway transport codes to stable statuses', () => {
    expect(connectorErrorStatus('INVALID_REQUEST')).toBe(400);
    expect(connectorErrorStatus('RATE_LIMITED')).toBe(429);
    expect(connectorErrorStatus('TOOL_UNAVAILABLE')).toBe(501);
  });

  it('keeps every code mapped to a status', () => {
    for (const code of CONNECTOR_ERROR_CODES) {
      expect(connectorErrorStatus(code)).toBeGreaterThanOrEqual(400);
    }
  });
});
