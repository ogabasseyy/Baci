import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteBlogEditorImage,
  requestBlogEditorAiEdit,
  uploadBlogEditorImage,
  uploadBlogEditorImageDetails,
} from '@/components/blog-editor/blog-editor-api';

const mocks = vi.hoisted(() => ({
  createUploadFormData: vi.fn(),
}));

vi.mock('@/lib/upload/createUploadFormData', () => ({
  createUploadFormData: mocks.createUploadFormData,
}));

const ACCESS_TOKEN = 'token';
const API_URL = 'https://api.usebaci.com';
const DEFAULT_ASSET = {
  fileName: 'hero.png',
  mimeType: 'image/png',
  uri: 'file:///hero.png',
};
const DEFAULT_PATH = 'merchant-1/blog/hero.png';
const DEFAULT_URL = 'https://cdn.usebaci.com/image.png';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

function stubFetch(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body, status)));
}

describe('blog-editor-api', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    mocks.createUploadFormData.mockReturnValue(new FormData());
  });

  it('returns AI-edited content on success', async () => {
    stubFetch({ content: '<p>Updated</p>' });

    await expect(
      requestBlogEditorAiEdit({
        accessToken: ACCESS_TOKEN,
        apiUrl: API_URL,
        content: '<p>Hello</p>',
        instruction: 'Make it warmer',
      })
    ).resolves.toBe('<p>Updated</p>');
  });

  it('rejects AI responses that omit content even when the request succeeds', async () => {
    stubFetch({ ok: true });

    await expect(
      requestBlogEditorAiEdit({
        accessToken: ACCESS_TOKEN,
        apiUrl: API_URL,
        content: '<p>Hello</p>',
        instruction: 'Make it warmer',
      })
    ).rejects.toThrow('AI edit failed: response did not include content');
  });

  it('rejects AI responses that contain only whitespace content', async () => {
    stubFetch({ content: '   ' });

    await expect(
      requestBlogEditorAiEdit({
        accessToken: ACCESS_TOKEN,
        apiUrl: API_URL,
        content: '<p>Hello</p>',
        instruction: 'Make it warmer',
      })
    ).rejects.toThrow('AI edit failed: empty content');
  });

  it('returns an uploaded image URL on success', async () => {
    stubFetch({ path: DEFAULT_PATH, url: DEFAULT_URL });

    await expect(
      uploadBlogEditorImage({
        accessToken: ACCESS_TOKEN,
        apiUrl: API_URL,
        asset: DEFAULT_ASSET,
      })
    ).resolves.toBe(DEFAULT_URL);
  });

  it('rejects uploaded image URLs when the success body is missing file details', async () => {
    stubFetch({ ok: true });

    await expect(
      uploadBlogEditorImage({
        accessToken: ACCESS_TOKEN,
        apiUrl: API_URL,
        asset: DEFAULT_ASSET,
      })
    ).rejects.toThrow('Upload API response did not include file details');
  });

  it('returns uploaded image details for cleanup flows', async () => {
    stubFetch({ path: DEFAULT_PATH, url: DEFAULT_URL });

    await expect(
      uploadBlogEditorImageDetails({
        accessToken: ACCESS_TOKEN,
        apiUrl: API_URL,
        asset: DEFAULT_ASSET,
      })
    ).resolves.toEqual({ path: DEFAULT_PATH, url: DEFAULT_URL });
  });

  it('rejects uploaded image detail responses when url or path is missing', async () => {
    stubFetch({ url: DEFAULT_URL });

    await expect(
      uploadBlogEditorImageDetails({
        accessToken: ACCESS_TOKEN,
        apiUrl: API_URL,
        asset: DEFAULT_ASSET,
      })
    ).rejects.toThrow('Upload API response did not include file details');
  });

  it('surfaces upload API errors', async () => {
    stubFetch({ error: 'Upload failed' }, 500);

    await expect(
      uploadBlogEditorImage({
        accessToken: ACCESS_TOKEN,
        apiUrl: API_URL,
        asset: DEFAULT_ASSET,
      })
    ).rejects.toThrow('Upload failed (500): Upload failed');
  });

  it('surfaces upload detail API errors', async () => {
    stubFetch({ error: 'Upload failed' }, 500);

    await expect(
      uploadBlogEditorImageDetails({
        accessToken: ACCESS_TOKEN,
        apiUrl: API_URL,
        asset: DEFAULT_ASSET,
      })
    ).rejects.toThrow('Upload failed (500): Upload failed');
  });

  it('deletes uploaded blog images when cleanup is required', async () => {
    stubFetch({ success: true });

    await expect(
      deleteBlogEditorImage({
        accessToken: ACCESS_TOKEN,
        apiUrl: API_URL,
        path: DEFAULT_PATH,
      })
    ).resolves.toBeUndefined();
  });

  it('rejects delete responses that do not confirm success', async () => {
    stubFetch({ ok: true });

    await expect(
      deleteBlogEditorImage({
        accessToken: ACCESS_TOKEN,
        apiUrl: API_URL,
        path: DEFAULT_PATH,
      })
    ).rejects.toThrow('Delete API response did not confirm success');
  });

  it('surfaces delete API errors', async () => {
    stubFetch({ error: 'Image not found' }, 404);

    await expect(
      deleteBlogEditorImage({
        accessToken: ACCESS_TOKEN,
        apiUrl: API_URL,
        path: DEFAULT_PATH,
      })
    ).rejects.toThrow('Delete failed (404): Image not found');
  });

  it('surfaces server-side API errors', async () => {
    stubFetch({ error: 'Gateway timeout' }, 504);

    await expect(
      requestBlogEditorAiEdit({
        accessToken: ACCESS_TOKEN,
        apiUrl: API_URL,
        content: '<p>Hello</p>',
        instruction: 'Retry',
      })
    ).rejects.toThrow('AI edit failed (504): Gateway timeout');
  });

  it('surfaces network-level AI edit failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Network request failed'))
    );

    await expect(
      requestBlogEditorAiEdit({
        accessToken: ACCESS_TOKEN,
        apiUrl: API_URL,
        content: '<p>Hello</p>',
        instruction: 'Retry',
      })
    ).rejects.toThrow('Network request failed');
  });

  it('surfaces timeout-specific AI edit failures', async () => {
    vi.useFakeTimers();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url, init) => {
        const signal = init?.signal;

        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(
              Object.assign(new Error('The operation was aborted'), {
                name: 'AbortError',
              })
            );
          });
        });
      })
    );

    const requestPromise = requestBlogEditorAiEdit({
      accessToken: ACCESS_TOKEN,
      apiUrl: API_URL,
      content: '<p>Hello</p>',
      instruction: 'Retry',
      timeoutMs: 50,
    });
    const assertion = expect(requestPromise).rejects.toThrow(
      'AI edit timed out after 50ms'
    );

    await vi.advanceTimersByTimeAsync(50);
    await assertion;

    vi.useRealTimers();
  });
});
