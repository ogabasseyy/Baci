import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('fixture shipping locations route', () => {
  it('returns deterministic local delivery locations', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      states: ['Lagos'],
      locations: [{ city: 'Ikeja', state: 'Lagos' }],
    });
  });
});
