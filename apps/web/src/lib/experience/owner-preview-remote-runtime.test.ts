// @vitest-environment node
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  getRemoteOwnerPreview,
  installRemoteOwnerPreview,
} from './owner-preview-remote-runtime';

it('installs only one remote preview and revokes in-flight results on uninstall', async () => {
  let finish: ((value: unknown) => void) | undefined;
  const remote = vi.fn(
    () =>
      new Promise<unknown>((resolve) => {
        finish = resolve;
      })
  );
  const uninstall = installRemoteOwnerPreview(remote);
  expect(() => installRemoteOwnerPreview(remote)).toThrow(
    'REMOTE_OWNER_PREVIEW_ALREADY_INSTALLED'
  );
  const pending = getRemoteOwnerPreview()?.({} as never, {} as never);
  uninstall();
  finish?.({ ok: true });
  await expect(pending).rejects.toThrow('REMOTE_OWNER_PREVIEW_UNAVAILABLE');
  expect(getRemoteOwnerPreview()).toBeUndefined();
  uninstall();
});
