import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('fixture csrf route', () => {
  it('returns the seeded token and a matching browser-readable cookie', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ token: 'fixture-csrf-token' });
    expect(response.headers.get('set-cookie')).toContain(
      'csrf-token=fixture-csrf-token'
    );
  });
});
