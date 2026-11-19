import { expect, it, vi } from 'vitest';
import {
  getExperienceOwnerRuntime,
  installExperienceOwnerRuntime,
} from './owner-runtime';

it('fails closed before installation and stale uninstall cannot remove a replacement', () => {
  expect(getExperienceOwnerRuntime()).toBeUndefined();
  const a = { createPreviewLaunch: vi.fn() };
  const remove = installExperienceOwnerRuntime(a);
  expect(() => installExperienceOwnerRuntime(a)).toThrow();
  remove();
  const b = { createPreviewLaunch: vi.fn() };
  const cleanup = installExperienceOwnerRuntime(b);
  try {
    remove();
    expect(getExperienceOwnerRuntime()).toBe(b);
  } finally {
    cleanup();
  }
  expect(getExperienceOwnerRuntime()).toBeUndefined();
});
