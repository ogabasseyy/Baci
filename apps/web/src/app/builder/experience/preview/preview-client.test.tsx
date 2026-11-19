import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const apiPost = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ apiPost }));
vi.mock('@/components/storefront/experience/ExperienceFrame', () => ({
  ExperienceFrame: ({
    launch,
    isActive,
  }: {
    launch: { instanceId: string };
    isActive: () => Promise<boolean>;
  }) => (
    <div data-testid="frame" data-instance={launch.instanceId}>
      <button
        type="button"
        onClick={async (event) => {
          event.currentTarget.dataset.active = String(await isActive());
        }}
      >
        Check active
      </button>
    </div>
  ),
}));

import { PreviewClient } from './preview-client';

afterEach(() => {
  apiPost.mockReset();
  vi.unstubAllGlobals();
});

it('a failed launch offers a safe retry rather than an empty iframe', async () => {
  apiPost.mockRejectedValue(Error('unavailable'));
  render(<PreviewClient merchantId="m" buildId="b" />);
  fireEvent.click(screen.getByRole('button', { name: 'Open private preview' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByTitle('Private full-code experience')).toBeNull();
  expect(
    screen
      .getByRole('button', { name: 'Open private preview' })
      .hasAttribute('disabled')
  ).toBe(false);
});

const launch = {
  instanceId: 'instance-1',
  bindingId: 'binding/1',
  merchantId: 'merchant-1',
  nonce: 'nonce',
  buildDigest: 'a'.repeat(64),
  src: 'https://preview.example/preview',
  expiresAt: Date.now() + 60_000,
  canonicalBase: 'https://shop.example',
  routes: [{ path: '/', view: 'home' as const }],
  bootstrap: {
    catalog: { products: [], revision: 'catalog-1' },
    route: {
      epoch: 1,
      routeId: 'home',
      canonicalPath: '/',
      params: {},
      publicDataRevision: 'catalog-1',
    },
    capabilities: [],
  },
};

it('creates the preview and makes a scoped activity check that fails closed', async () => {
  apiPost.mockResolvedValue(launch);
  const fetchMock = vi.fn(async () => ({ ok: false, json: vi.fn() }));
  vi.stubGlobal('fetch', fetchMock);

  render(<PreviewClient merchantId="merchant-1" buildId="build-1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Open private preview' }));

  expect(await screen.findByTestId('frame')).toHaveAttribute(
    'data-instance',
    'instance-1'
  );
  expect(apiPost).toHaveBeenCalledWith('/api/builder-experience/preview', {
    merchantId: 'merchant-1',
    buildId: 'build-1',
  });
  const activeButton = screen.getByRole('button', { name: 'Check active' });
  fireEvent.click(activeButton);
  await waitFor(() =>
    expect(activeButton).toHaveAttribute('data-active', 'false')
  );
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/builder-experience/preview?bindingId=binding%2F1&merchantId=merchant-1',
    { cache: 'no-store' }
  );
});

it('accepts only a successful response with active set to true', async () => {
  apiPost.mockResolvedValue(launch);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ active: true }),
    }))
  );
  render(<PreviewClient merchantId="merchant-1" buildId="build-1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Open private preview' }));
  const activeButton = await screen.findByRole('button', {
    name: 'Check active',
  });
  fireEvent.click(activeButton);
  await waitFor(() =>
    expect(activeButton).toHaveAttribute('data-active', 'true')
  );
});

it.each([
  {
    label: 'malformed JSON',
    response: { ok: true, json: async () => 'active' },
  },
  {
    label: 'missing activity flag',
    response: { ok: true, json: async () => ({}) },
  },
  {
    label: 'non-boolean activity flag',
    response: { ok: true, json: async () => ({ active: 'true' }) },
  },
])('returns false for $label activity responses', async ({ response }) => {
  apiPost.mockResolvedValue(launch);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response)
  );
  render(<PreviewClient merchantId="merchant-1" buildId="build-1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Open private preview' }));
  const activeButton = await screen.findByRole('button', {
    name: 'Check active',
  });
  fireEvent.click(activeButton);
  await waitFor(() =>
    expect(activeButton).toHaveAttribute('data-active', 'false')
  );
});

it.each([
  'network failure',
  'invalid JSON',
])('returns false on %s', async (failure) => {
  apiPost.mockResolvedValue(launch);
  const fetchMock = vi.fn(async () => {
    if (failure === 'network failure') throw Error('offline');
    return {
      ok: true,
      json: async () => {
        throw Error('invalid JSON');
      },
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<PreviewClient merchantId="merchant-1" buildId="build-1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Open private preview' }));
  const activeButton = await screen.findByRole('button', {
    name: 'Check active',
  });
  fireEvent.click(activeButton);
  await waitFor(() =>
    expect(activeButton).toHaveAttribute('data-active', 'false')
  );
});

it('launches the exact route requested by the preview link', async () => {
  apiPost.mockResolvedValue(launch);
  render(
    <PreviewClient merchantId="m" buildId="b" routeId="/collections/all" />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open private preview' }));
  await waitFor(() =>
    expect(apiPost).toHaveBeenCalledWith('/api/builder-experience/preview', {
      merchantId: 'm',
      buildId: 'b',
      routeId: '/collections/all',
    })
  );
});
