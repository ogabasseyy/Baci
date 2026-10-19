import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGraphicsHubLinks } from './category-page-graphics-hub-links';

const { mockLoadPublished } = vi.hoisted(() => ({
  mockLoadPublished: vi.fn(),
}));

vi.mock(
  '@/lib/storefront-category/load-published-gaming-laptop-graphics-hubs',
  () => ({
    loadPublishedGamingLaptopGraphicsHubs: mockLoadPublished,
  })
);

const store = { id: 'store-1' };

beforeEach(() => {
  mockLoadPublished.mockReset();
});

describe('loadGraphicsHubLinks', () => {
  it('returns no links outside the gaming-laptops category', async () => {
    await expect(
      loadGraphicsHubLinks({
        category: 'phones',
        graphicsOptions: ['NVIDIA RTX 4070'],
        requestScopedBaseUrl: 'https://store.example',
        slug: 'store',
        store,
      })
    ).resolves.toEqual([]);
    expect(mockLoadPublished).not.toHaveBeenCalled();
  });

  it('maps published hubs to comparison links', async () => {
    mockLoadPublished.mockResolvedValue([
      { label: 'RTX 4070', slug: 'rtx-4070' },
    ]);
    await expect(
      loadGraphicsHubLinks({
        category: 'gaming-laptops',
        graphicsOptions: ['NVIDIA RTX 4070'],
        requestScopedBaseUrl: 'https://store.example',
        slug: 'store',
        store,
      })
    ).resolves.toEqual([
      {
        href: 'https://store.example/gaming-laptops/graphics/rtx-4070',
        label: 'Shop RTX 4070 gaming laptops',
      },
    ]);
  });

  it('returns no links when hub qualification fails', async () => {
    mockLoadPublished.mockRejectedValue(new Error('offline'));
    await expect(
      loadGraphicsHubLinks({
        category: 'gaming-laptops',
        graphicsOptions: ['NVIDIA RTX 4070'],
        requestScopedBaseUrl: 'https://store.example',
        slug: 'store',
        store,
      })
    ).resolves.toEqual([]);
  });
});
