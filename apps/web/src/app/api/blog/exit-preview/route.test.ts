import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRedirect = vi.fn();
const mockDisableDraft = vi.fn();

vi.mock('next/navigation', () => ({
  redirect: (target: string) => {
    mockRedirect(target);
    throw new Error(`NEXT_REDIRECT: ${target}`);
  },
}));

vi.mock('next/headers', () => ({
  draftMode: vi.fn(async () => ({
    disable: mockDisableDraft,
  })),
}));

import { GET } from './route';

describe('GET /api/blog/exit-preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disables draft mode and redirects to a valid relative callbackUrl', async () => {
    const request = new Request(
      'https://usebaci.com/api/blog/exit-preview?callbackUrl=/merchant/blog/post-1'
    );

    await expect(GET(request)).rejects.toThrow(
      'NEXT_REDIRECT: /merchant/blog/post-1'
    );

    expect(mockDisableDraft).toHaveBeenCalledTimes(1);
    expect(mockRedirect).toHaveBeenCalledWith('/merchant/blog/post-1');
  });

  it('falls back to /blog when callbackUrl is omitted', async () => {
    const request = new Request('https://usebaci.com/api/blog/exit-preview');

    await expect(GET(request)).rejects.toThrow('NEXT_REDIRECT: /blog');

    expect(mockDisableDraft).toHaveBeenCalledTimes(1);
    expect(mockRedirect).toHaveBeenCalledWith('/blog');
  });

  it('falls back to /blog when callbackUrl is an absolute external URL', async () => {
    const request = new Request(
      'https://usebaci.com/api/blog/exit-preview?callbackUrl=https://evil.com/phishing'
    );

    await expect(GET(request)).rejects.toThrow('NEXT_REDIRECT: /blog');

    expect(mockDisableDraft).toHaveBeenCalledTimes(1);
    expect(mockRedirect).toHaveBeenCalledWith('/blog');
  });

  it('falls back to /blog when callbackUrl is a protocol-relative URL', async () => {
    const request = new Request(
      'https://usebaci.com/api/blog/exit-preview?callbackUrl=//evil.com/phishing'
    );

    await expect(GET(request)).rejects.toThrow('NEXT_REDIRECT: /blog');

    expect(mockDisableDraft).toHaveBeenCalledTimes(1);
    expect(mockRedirect).toHaveBeenCalledWith('/blog');
  });

  it('falls back to /blog for protocol-relative bypass attempts using dot segments', async () => {
    const request = new Request(
      'https://usebaci.com/api/blog/exit-preview?callbackUrl=/..//evil.example'
    );

    await expect(GET(request)).rejects.toThrow('NEXT_REDIRECT: /blog');

    expect(mockDisableDraft).toHaveBeenCalledTimes(1);
    expect(mockRedirect).toHaveBeenCalledWith('/blog');
  });

  it('falls back to /blog for javascript: and backslash open-redirect attempts', async () => {
    for (const malicious of ['javascript:alert(1)', '/\\evil.com', '   ']) {
      vi.clearAllMocks();
      const request = new Request(
        `https://usebaci.com/api/blog/exit-preview?callbackUrl=${encodeURIComponent(malicious)}`
      );

      await expect(GET(request)).rejects.toThrow('NEXT_REDIRECT: /blog');
      expect(mockDisableDraft).toHaveBeenCalledTimes(1);
      expect(mockRedirect).toHaveBeenCalledWith('/blog');
    }
  });
});
