import { beforeEach, expect, it, vi } from 'vitest';
import { generateMetadata } from './page';

const mocks = vi.hoisted(() => ({
  preview: false,
  loadLineup: vi.fn(),
}));
vi.mock('next/headers', () => ({ headers: () => new Headers() }));
vi.mock('@/config/ogabassey-black-friday', () => ({
  get IS_BLACK_FRIDAY_PREVIEW() {
    return mocks.preview;
  },
}));
vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: vi.fn(() => ({ slug: 'ogabassey' })),
}));
vi.mock('@/lib/ogabassey-black-friday', () => ({
  getBlackFridayProducts: mocks.loadLineup,
  isPublishedOgabassey: () => true,
}));
vi.mock('@/lib/store-url', () => ({
  buildRequestScopedStoreUrl: () => 'https://ogabassey.com',
}));
vi.mock('../(catalog)/(listing)/[category]/page', () => ({
  default: () => null,
  generateMetadata: vi.fn(),
}));

const props = {
  params: Promise.resolve({ slug: 'ogabassey' }),
  searchParams: Promise.resolve({}),
};

beforeEach(() => {
  mocks.preview = false;
  mocks.loadLineup.mockReset();
});

it('indexes the canonical campaign URL once the lineup has products', async () => {
  mocks.loadLineup.mockResolvedValue([{ id: 'offer' }]);
  expect(await generateMetadata(props)).toMatchObject({
    alternates: { canonical: 'https://ogabassey.com/black-friday' },
    robots: { index: true, follow: true },
  });
});

it.each([
  false,
  true,
])('keeps an empty or preview lineup out of search (preview: %s)', async (preview) => {
  mocks.preview = preview;
  mocks.loadLineup.mockResolvedValue([]);
  expect(await generateMetadata(props)).toMatchObject({
    robots: { index: false, follow: true },
  });
  if (preview) expect(mocks.loadLineup).not.toHaveBeenCalled();
});
