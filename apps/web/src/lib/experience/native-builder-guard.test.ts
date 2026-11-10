import { expect, it, vi } from 'vitest';

vi.mock('./owner-runtime', () => ({ getExperienceOwnerRuntime: vi.fn() }));
vi.mock('./authoring-mode', () => ({ readExperienceAuthoringMode: vi.fn() }));

import { readExperienceAuthoringMode } from './authoring-mode';
import { denyNativeLegacyMutation } from './native-builder-guard';
import { getExperienceOwnerRuntime } from './owner-runtime';

it('disabled profile preserves native behavior; enabled full-code blocks native writes and unknown mode fails closed', async () => {
  vi.mocked(getExperienceOwnerRuntime).mockReturnValue(undefined);
  expect(await denyNativeLegacyMutation({} as never, 'merchant')).toBeNull();
  expect(readExperienceAuthoringMode).not.toHaveBeenCalled();
  vi.mocked(getExperienceOwnerRuntime).mockReturnValue({
    approval: {},
  } as never);
  vi.mocked(readExperienceAuthoringMode).mockResolvedValue('legacy');
  expect(await denyNativeLegacyMutation({} as never, 'merchant')).toBeNull();
  vi.mocked(readExperienceAuthoringMode).mockResolvedValue('full-code');
  const response = await denyNativeLegacyMutation({} as never, 'merchant');
  expect(response?.status).toBe(409);
  expect(await response?.json()).toMatchObject({
    editorUrl: '/builder/experience?merchant=merchant',
  });
  vi.mocked(readExperienceAuthoringMode).mockResolvedValue('unknown' as never);
  expect(
    (await denyNativeLegacyMutation({} as never, 'merchant'))?.status
  ).toBe(503);
});
