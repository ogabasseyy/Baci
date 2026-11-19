import { afterEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { oxygenPurposeKey, oxygenWriteVersion } from './purpose-key-crypto';

afterEach(() => vi.unstubAllEnvs());

it('derives stable, 32-byte keys separated by purpose and root', () => {
  const root = Buffer.alloc(32, 1);
  const draft = oxygenPurposeKey(root, 'form-draft');
  expect(draft).toHaveLength(32);
  expect(oxygenPurposeKey(root, 'form-draft')).toEqual(draft);
  expect(oxygenPurposeKey(root, 'phone-handoff')).not.toEqual(draft);
  expect(oxygenPurposeKey(root, 'residential-draft')).not.toEqual(draft);
  expect(oxygenPurposeKey(Buffer.alloc(32, 2), 'form-draft')).not.toEqual(
    draft
  );
});

it('defaults to v1 writes and enables v2 only for the exact opt-in value', () => {
  vi.stubEnv('OXYGEN_PURPOSE_KEY_V2_WRITE', '');
  expect(oxygenWriteVersion()).toBe('v1');
  vi.stubEnv('OXYGEN_PURPOSE_KEY_V2_WRITE', 'TRUE');
  expect(oxygenWriteVersion()).toBe('v1');
  vi.stubEnv('OXYGEN_PURPOSE_KEY_V2_WRITE', 'true');
  expect(oxygenWriteVersion()).toBe('v2');
});
