import { describe, expect, it, vi } from 'vitest';
import { uploadBlogMedia } from './blog-media-upload';

const fetchWithCsrf = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf }));

const file = new File(['image'], 'photo.png', { type: 'image/png' });

function jsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: async () => payload,
  } as Response;
}

describe('uploadBlogMedia', () => {
  it('posts the file and purpose as multipart form data', async () => {
    fetchWithCsrf.mockResolvedValueOnce(
      jsonResponse({ url: 'https://cdn.example.com/media/a.png' })
    );
    await uploadBlogMedia(file, 'inline');
    expect(fetchWithCsrf).toHaveBeenCalledWith('/api/admin/blog/upload', {
      body: expect.any(FormData),
      method: 'POST',
    });
    const body = fetchWithCsrf.mock.calls[0][1].body as FormData;
    expect(body.get('file')).toBe(file);
    expect(body.get('purpose')).toBe('inline');
  });

  it('returns dimensions and variants when present', async () => {
    fetchWithCsrf.mockResolvedValueOnce(
      jsonResponse({
        height: 100,
        url: 'https://cdn.example.com/media/a.png',
        variants: { square_1x1: 'https://cdn.example.com/media/a-1x1.webp' },
        width: 200,
      })
    );
    await expect(uploadBlogMedia(file, 'featured')).resolves.toEqual({
      height: 100,
      url: 'https://cdn.example.com/media/a.png',
      variants: { square_1x1: 'https://cdn.example.com/media/a-1x1.webp' },
      width: 200,
    });
  });

  it('normalizes a minimal payload with nulls and empty variants', async () => {
    fetchWithCsrf.mockResolvedValueOnce(
      jsonResponse({ url: 'https://cdn.example.com/media/a.png' })
    );
    await expect(uploadBlogMedia(file, 'featured')).resolves.toEqual({
      height: null,
      url: 'https://cdn.example.com/media/a.png',
      variants: {},
      width: null,
    });
  });

  it('throws the server error message on failure', async () => {
    fetchWithCsrf.mockResolvedValueOnce(
      jsonResponse({ error: 'File too large' }, false)
    );
    await expect(uploadBlogMedia(file, 'inline')).rejects.toThrow(
      'File too large'
    );
  });

  it('throws a default message when the failure has no payload', async () => {
    fetchWithCsrf.mockResolvedValueOnce({
      ok: false,
      json: async () => {
        throw new Error('no json');
      },
    } as unknown as Response);
    await expect(uploadBlogMedia(file, 'inline')).rejects.toThrow(
      'Failed to upload image'
    );
  });

  it('throws when a successful response omits the URL', async () => {
    fetchWithCsrf.mockResolvedValueOnce(jsonResponse({ width: 10 }));
    await expect(uploadBlogMedia(file, 'inline')).rejects.toThrow(
      'Upload response did not include a URL'
    );
  });
});
