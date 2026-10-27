import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { GET } from './route';

function request(input = ''): NextRequest {
  return new NextRequest(
    `http://localhost/api/places/autocomplete?input=${input}`
  );
}

describe('fixture places autocomplete route', () => {
  it('returns no predictions for an empty query', async () => {
    const response = GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ predictions: [] });
  });

  it('returns only the deterministic local pickup address', async () => {
    const response = GET(request('Station%20Road'));
    const body = (await response.json()) as {
      predictions: Array<{ placeId: string; provider: string }>;
    };
    expect(response.status).toBe(200);
    expect(body.predictions).toEqual([
      expect.objectContaining({
        placeId: 'geoapify:local-repair-fixture',
        provider: 'geoapify',
      }),
    ]);
  });
});
