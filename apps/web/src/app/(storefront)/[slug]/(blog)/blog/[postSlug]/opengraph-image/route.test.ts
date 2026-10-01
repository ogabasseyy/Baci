import { describe, expect, it, vi } from 'vitest';

const { mockImage } = vi.hoisted(() => ({
  mockImage: vi.fn(),
}));

vi.mock('../opengraph-image-renderer', () => ({
  default: (props: unknown) => mockImage(props),
}));

import { GET } from './route';

describe('explicit merchant blog social image route', () => {
  it('delegates to the merchant blog OG image renderer with route params', async () => {
    const response = new Response('png', {
      headers: { 'content-type': 'image/png' },
    });
    const params = Promise.resolve({
      slug: 'ogabassey.com',
      postSlug: 'airpods-max',
    });
    mockImage.mockResolvedValue(response);

    await expect(
      GET(
        new Request('https://ogabassey.com/blog/airpods-max/opengraph-image'),
        {
          params,
        }
      )
    ).resolves.toBe(response);

    expect(mockImage).toHaveBeenCalledWith({ params });
  });

  it('lets renderer failures surface as route failures', async () => {
    const params = Promise.resolve({
      slug: 'ogabassey.com',
      postSlug: 'airpods-max',
    });
    mockImage.mockRejectedValue(new Error('render failed'));

    await expect(
      GET(
        new Request('https://ogabassey.com/blog/airpods-max/opengraph-image'),
        {
          params,
        }
      )
    ).rejects.toThrow('render failed');

    expect(mockImage).toHaveBeenCalledWith({ params });
  });
});
