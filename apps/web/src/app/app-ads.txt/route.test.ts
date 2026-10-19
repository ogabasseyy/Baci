import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('platform app-ads.txt route', () => {
  it('serves the AdMob seller declaration as plain text on ogabassey.com', async () => {
    const response = GET(
      new Request('https://ogabassey.com/app-ads.txt', {
        headers: { host: 'ogabassey.com' },
      })
    );

    expect(response.headers.get('content-type')).toBe(
      'text/plain; charset=utf-8'
    );
    await expect(response.text()).resolves.toBe(
      'google.com, pub-9332275663101466, DIRECT, f08c47fec0942fa0\n'
    );
  });
});
