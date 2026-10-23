import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enabled: true,
  user: vi.fn(),
  disconnect: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock('@/config/builder-linking', () => ({
  get BUILDER_ACCOUNT_LINKING_ENABLED() {
    return mocks.enabled;
  },
}));
vi.mock('@/lib/builder-connector/management', () => ({
  disconnectBuilderConnection: mocks.disconnect,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.user } }),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));

import { disconnectBuilderAction } from './actions';

const id = '20000000-0000-4000-8000-000000000001';
function form(value: string = id) {
  const data = new FormData();
  data.set('connectionId', value);
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = true;
  mocks.user.mockResolvedValue({ data: { user: { id } }, error: null });
});
it('rejects signed-out or failed-auth callers before disconnecting', async () => {
  for (const response of [
    { data: { user: null }, error: null },
    { data: { user: { id } }, error: new Error('auth') },
  ]) {
    mocks.user.mockResolvedValue(response);
    await expect(disconnectBuilderAction(form())).rejects.toThrow('Sign in');
  }
  expect(mocks.disconnect).not.toHaveBeenCalled();
});
it('rejects disabled linking and invalid UUID inputs before disconnecting', async () => {
  mocks.enabled = false;
  await expect(disconnectBuilderAction(form())).rejects.toThrow('not enabled');
  mocks.enabled = true;
  for (const data of [form('invalid'), new FormData()])
    await expect(disconnectBuilderAction(data)).rejects.toThrow();
  expect(mocks.disconnect).not.toHaveBeenCalled();
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it('delegates authenticated validated input and revalidates only on success', async () => {
  await disconnectBuilderAction(form());
  expect(mocks.disconnect).toHaveBeenCalledWith(
    expect.objectContaining({ auth: { getUser: mocks.user } }),
    id
  );
  expect(mocks.user.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.disconnect.mock.invocationCallOrder[0]
  );
  expect(mocks.revalidate).toHaveBeenCalledWith(
    '/dashboard/integrations/chatgpt'
  );
  mocks.revalidate.mockClear();
  mocks.disconnect.mockRejectedValueOnce(new Error('rejected'));
  await expect(disconnectBuilderAction(form())).rejects.toThrow('rejected');
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
