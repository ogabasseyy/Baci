import { describe, expect, it } from 'vitest';
import { getBuilderAiCsrfRequest } from './get-builder-ai-csrf-request';

describe('getBuilderAiCsrfRequest', () => {
  it('removes a stale Bearer header without consuming the body', async () => {
    const request = new Request('http://localhost/edit', {
      body: '{"prompt":"edit"}',
      headers: { Authorization: 'Bearer expired' },
      method: 'POST',
    });
    const csrfRequest = getBuilderAiCsrfRequest(request, 'cookie');
    expect(csrfRequest.headers.has('Authorization')).toBe(false);
    await expect(request.text()).resolves.toBe('{"prompt":"edit"}');
  });
});
