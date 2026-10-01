import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('fixture IMEI remediation orders route', () => {
  it('returns an empty deterministic guest order list', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ orders: [] });
  });
});
