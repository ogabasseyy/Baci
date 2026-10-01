import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('fixture Redvault availability route', () => {
  it('reports the provider as unavailable in the manual harness', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false, available: false });
  });
});
