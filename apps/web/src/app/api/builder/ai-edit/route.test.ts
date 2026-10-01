import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handle = vi.hoisted(() => vi.fn());
vi.mock('./handle-builder-ai-edit-request', () => ({
  handleBuilderAiEditRequest: handle,
}));

describe('/api/builder/ai-edit route', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates the versioned endpoint to the candidate handler', async () => {
    handle.mockResolvedValue(Response.json({ candidateConfig: {} }));
    const { POST } = await import('./route');
    const request = new NextRequest('http://localhost/api/builder/ai-edit', {
      method: 'POST',
    });

    const response = await POST(request);

    expect(handle).toHaveBeenCalledWith(request);
    await expect(response.json()).resolves.toEqual({ candidateConfig: {} });
  });
});
