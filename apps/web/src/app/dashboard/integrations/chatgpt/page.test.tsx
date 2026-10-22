import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  enabled: false,
  list: vi.fn(),
  disconnect: vi.fn(),
  client: vi.fn(),
}));
vi.mock('@/config/builder-linking', () => ({
  get BUILDER_ACCOUNT_LINKING_ENABLED() {
    return state.enabled;
  },
}));
vi.mock('@/lib/builder-connector/management', () => ({
  listBuilderConnections: state.list,
  disconnectBuilderConnection: state.disconnect,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: state.client }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not-found');
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { disconnectBuilderAction } from './actions';
import Page from './page';

beforeEach(() => {
  state.enabled = false;
  vi.clearAllMocks();
  state.client.mockResolvedValue({});
});
it('keeps account linking disabled until the release gate', async () => {
  await expect(Page()).rejects.toThrow('not-found');
  await expect(disconnectBuilderAction(new FormData())).rejects.toThrow(
    'not enabled'
  );
  expect(state.client).not.toHaveBeenCalled();
});
it('renders safe connection metadata and offers disconnect', async () => {
  state.enabled = true;
  state.list.mockResolvedValue([
    {
      connection_id: '20000000-0000-4000-8000-000000000001',
      scopes: ['storefront.read'],
      status: 'active',
      expires_at: '2026-11-01T00:00:00Z',
      created_at: '2026-10-22T00:00:00Z',
    },
  ]);
  render(await Page());
  expect(
    screen.getByRole('heading', { name: 'ChatGPT website builder connections' })
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Disconnect' })).toBeVisible();
});
it('disconnect action delegates to authenticated owner management', async () => {
  state.enabled = true;
  const form = new FormData();
  form.set('connectionId', '20000000-0000-4000-8000-000000000001');
  await disconnectBuilderAction(form);
  expect(state.disconnect).toHaveBeenCalledWith(
    {},
    '20000000-0000-4000-8000-000000000001'
  );
});
