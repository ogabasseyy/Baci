import { describe, expect, it } from 'vitest';
import {
  throwVtuPersistenceError,
  VtuPersistenceError,
} from './vtu-persistence-error';

describe('vtu-persistence-error', () => {
  it('identifies as VtuPersistenceError across realms (name + instanceof)', () => {
    const error = new VtuPersistenceError('write failed');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(VtuPersistenceError);
    expect(error.name).toBe('VtuPersistenceError');
    expect(error.message).toBe('write failed');
  });

  it('throwVtuPersistenceError throws the custom type', () => {
    expect(() => throwVtuPersistenceError('metadata lost')).toThrow(
      VtuPersistenceError
    );
    expect(() => throwVtuPersistenceError('metadata lost')).toThrow(
      'metadata lost'
    );
  });
});
