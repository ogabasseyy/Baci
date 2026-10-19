import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('fixture storefront session route', () => {
  it('keeps the checkout in guest mode', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: false });
  });
});
