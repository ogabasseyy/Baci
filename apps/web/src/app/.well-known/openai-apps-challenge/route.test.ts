import { expect, it } from 'vitest';
import { GET } from './route';

it('serves the OpenAI challenge on the MCP hostname without caching', async () => {
  const response = GET(
    new Request('https://mcp.usebaci.com/.well-known/openai-apps-challenge')
  );

  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/plain');
  expect(response.headers.get('cache-control')).toBe('no-store');
  await expect(response.text()).resolves.toBe(
    'flm8d7tnA4QxHdY5JGbpwggiDuYBl15X88UQkXYcGTA'
  );
});

it('does not serve the challenge on another hostname', () => {
  expect(
    GET(new Request('https://usebaci.com/.well-known/openai-apps-challenge'))
      .status
  ).toBe(404);
});
