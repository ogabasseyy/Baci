import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handle = vi.hoisted(() => vi.fn());
vi.mock('../ai-edit/handle-builder-ai-edit-request', () => ({
  handleBuilderAiEditRequest: handle,
}));

describe('/api/builder/gemini legacy adapter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates the legacy endpoint to the candidate handler in legacy mode', async () => {
    handle.mockResolvedValue(Response.json({ config: { content: [] } }));
    const { POST } = await import('./route');
    const request = new NextRequest('http://localhost/api/builder/gemini', {
      body: JSON.stringify({
        currentConfig: { content: [] },
        prompt: 'Polish',
      }),
      method: 'POST',
    });

    const response = await POST(request);

    expect(handle).toHaveBeenCalledWith(request, { mode: 'legacy' });
    await expect(response.json()).resolves.toEqual({ config: { content: [] } });
  });
});
