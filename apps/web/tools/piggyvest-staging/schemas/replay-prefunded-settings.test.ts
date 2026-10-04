import { expect, it, vi } from 'vitest';
import { replayPrefundedSettings as schemas } from './replay-prefunded-settings';

it('requires exact bundle and configuration digests with no configurable paths', () => {
  const activation = {
    bundleSha256: 'a'.repeat(64),
    configurationSha256: 'b'.repeat(64),
  };
  expect(schemas.activation.parse(activation)).toEqual(activation);
  for (const value of [
    {},
    { ...activation, bundleSha256: 'A'.repeat(64) },
    { ...activation, configurationSha256: '' },
    { ...activation, path: '/tmp/other.mjs' },
    { ...activation, enabled: false },
  ])
    expect(schemas.activation.safeParse(value).success).toBe(false);
});

it('requires the named factory and only receipt runtime callbacks', () => {
  expect(schemas.module.safeParse({ default: vi.fn() }).success).toBe(false);
  expect(
    schemas.module.safeParse({ createPrefundedCardReplayRuntime: vi.fn() }).success
  ).toBe(true);
  const runtime = { resolveEnrollment: vi.fn(), replay: vi.fn() };
  expect(schemas.runtime.parse(runtime)).toEqual(runtime);
  for (const value of [
    {},
    { ...runtime, resolveEnrollment: null },
    { ...runtime, replay: 'callback' },
    { ...runtime, tick: vi.fn() },
    { ...runtime, readOriginalSignature: vi.fn() },
  ])
    expect(schemas.runtime.safeParse(value).success).toBe(false);
});
