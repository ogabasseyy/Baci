import { expect, it } from 'vitest';
import { mcpReadiness } from './mcp-readiness';

it('fails readiness for an expired OAuth worker despite a healthy anonymous catalog', () => {
  expect(mcpReadiness(true, 'expired')).toEqual({ statusCode: 503, status: 'unhealthy' });
});
it('keeps catalog-only health independent and warns without downtime before expiry', () => {
  expect(mcpReadiness(true)).toEqual({ statusCode: 200, status: 'healthy' });
  expect(mcpReadiness(true, 'rotation_required').statusCode).toBe(200);
  expect(mcpReadiness(false, 'ok').statusCode).toBe(503);
});
