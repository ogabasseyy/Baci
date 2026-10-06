/** @vitest-environment node */

import { describe, expect, it } from 'vitest';
import { isBenignFsError } from './security-integrity-benign-fs-error';

describe('security-integrity-benign-fs-error', () => {
  it.each(['ENOENT', 'ENOTDIR'])('treats %s as a benign skip', (code) => {
    expect(isBenignFsError(Object.assign(new Error(code), { code }))).toBe(
      true
    );
  });

  it('treats access and io errors as fail-closed', () => {
    for (const code of ['EACCES', 'EPERM', 'EIO', 'EBUSY']) {
      expect(isBenignFsError(Object.assign(new Error(code), { code }))).toBe(
        false
      );
    }
  });

  it('treats codeless and non-errors as fail-closed', () => {
    expect(isBenignFsError(new Error('plain'))).toBe(false);
    expect(isBenignFsError(undefined)).toBe(false);
    expect(isBenignFsError({ code: 42 })).toBe(false);
  });
});
