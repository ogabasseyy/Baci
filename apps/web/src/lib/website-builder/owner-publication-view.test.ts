import { beforeEach, expect, it, vi } from 'vitest';
import { loadInitialPublicationApproval } from './owner-publication-view';

const state = vi.hoisted(() => ({
  user: true,
  authError: false,
  linking: true,
  storage: true,
  runtime: true,
  load: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.user ? { id: 'owner' } : null },
        error: state.authError ? Error('private') : null,
      }),
    },
  }),
}));
vi.mock('@/config/builder-linking', () => ({
  get BUILDER_ACCOUNT_LINKING_ENABLED() {
    return state.linking;
  },
}));
vi.mock('@/config/builder-private-storage', () => ({
  get BUILDER_PRIVATE_STORAGE_ENABLED() {
    return state.storage;
  },
}));
vi.mock('./publication-runtime', () => ({
  getOwnerPublicationRuntime: () => (state.runtime ? () => {} : undefined),
}));
vi.mock('./load-publication', () => ({ loadPublishConfirmation: state.load }));
const id = '10000000-0000-4000-8000-000000000001';
beforeEach(() => {
  state.user = true;
  state.authError = false;
  state.linking = true;
  state.storage = true;
  state.runtime = true;
  state.load.mockReset();
});
it.each([
  'user',
  'authError',
] as const)('fails closed on %s authentication failure', async (key) => {
  state[key] = key === 'authError';
  expect((await loadInitialPublicationApproval(id)).signedOut).toBe(true);
  expect(state.load).not.toHaveBeenCalled();
});
it.each([
  'linking',
  'storage',
  'runtime',
] as const)('requires %s release readiness', async (key) => {
  state[key] = false;
  expect((await loadInitialPublicationApproval(id)).view).toBeNull();
  expect(state.load).not.toHaveBeenCalled();
});
it('validates the intent and redacts backend failures', async () => {
  expect((await loadInitialPublicationApproval('invalid')).view).toBeNull();
  expect(state.load).not.toHaveBeenCalled();
  state.load.mockRejectedValue(Error('private database detail'));
  expect((await loadInitialPublicationApproval(id)).error).not.toContain(
    'private database detail'
  );
});
it('loads an owner-scoped approval before sending client props', async () => {
  const view = { kind: 'receipt' };
  state.load.mockResolvedValue(view);
  expect(await loadInitialPublicationApproval(id)).toEqual({
    view,
    error: null,
    signedOut: false,
  });
  expect(state.load).toHaveBeenCalledWith(
    expect.objectContaining({ auth: expect.any(Object) }),
    id
  );
});
