import { describe, expect, it } from 'vitest';
import { requiresOwnerNameFields } from './requires-owner-name-fields';

describe('requiresOwnerNameFields', () => {
  it('requires name entry when social signup is missing a name', () => {
    expect(requiresOwnerNameFields('', 'Lovelace')).toBe(true);
    expect(requiresOwnerNameFields('Ada', '')).toBe(true);
    expect(requiresOwnerNameFields('  ', '  ')).toBe(true);
  });

  it('does not require name entry when email signup already collected the name', () => {
    expect(requiresOwnerNameFields('Ada', 'Lovelace')).toBe(false);
  });
});
