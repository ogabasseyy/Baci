import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('fixture places autocomplete route', () => {
  it('returns no external place predictions', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ predictions: [] });
  });
});
