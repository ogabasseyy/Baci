import { expect, it, vi } from 'vitest';
import { createFrameActivity } from './experience-frame-activity';

it('allows bounded initial host binding while checking admission once', async () => {
  let now = 0;
  let resolveAdmission: (valid: boolean) => void = () => {};
  const isActive = vi.fn(
    () => new Promise<boolean>((resolve) => (resolveAdmission = resolve))
  );
  const onInactive = vi.fn();
  let hostActive = false;
  const tick = createFrameActivity({
    host: true,
    hostActive: () => hostActive,
    isActive,
    expiresAt: 20_000,
    onInactive,
    now: () => now,
  });

  tick();
  tick();
  await Promise.resolve();
  expect(isActive).toHaveBeenCalledOnce();
  expect(onInactive).not.toHaveBeenCalled();

  now = 6_000;
  tick();
  expect(onInactive).not.toHaveBeenCalled();
  hostActive = true;
  now = 8_000;
  tick();
  expect(onInactive).not.toHaveBeenCalled();
  resolveAdmission(true);
  await Promise.resolve();
  expect(onInactive).not.toHaveBeenCalled();

  now = 21_000;
  tick();
  expect(onInactive).not.toHaveBeenCalled();
  hostActive = false;
  tick();
  expect(onInactive).toHaveBeenCalledOnce();
});

it('fails closed on denial, binding timeout, and private preview expiry', async () => {
  let now = 0;
  const denied = vi.fn();
  const deniedTick = createFrameActivity({
    host: true,
    hostActive: () => false,
    isActive: async () => false,
    expiresAt: 20_000,
    onInactive: denied,
    now: () => now,
  });
  deniedTick();
  await vi.waitFor(() => expect(denied).toHaveBeenCalledOnce());

  const timedOut = vi.fn();
  const pendingTick = createFrameActivity({
    host: true,
    hostActive: () => false,
    isActive: () => new Promise<boolean>(() => {}),
    expiresAt: 20_000,
    onInactive: timedOut,
    now: () => now,
  });
  pendingTick();
  now = 6_000;
  pendingTick();
  expect(timedOut).not.toHaveBeenCalled();
  now = 9_999;
  pendingTick();
  expect(timedOut).not.toHaveBeenCalled();
  now = 10_000;
  pendingTick();
  expect(timedOut).toHaveBeenCalledOnce();

  const expired = vi.fn();
  const previewTick = createFrameActivity({
    host: false,
    hostActive: () => false,
    isActive: async () => true,
    expiresAt: 1_000,
    onInactive: expired,
    now: () => now,
  });
  now = 1_000;
  previewTick();
  expect(expired).toHaveBeenCalledOnce();
});
