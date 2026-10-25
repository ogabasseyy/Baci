import { describe, expect, it } from 'vitest';
import { preflightRouteError } from './route-response';

describe('preflightRouteError', () => {
  it('returns the safe error shape with the requested status', async () => {
    const response = preflightRouteError('Selected products are stale', 409);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Selected products are stale',
    });
  });
});
