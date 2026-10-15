import { describe, expect, it } from 'vitest';
import {
  isVtuConcurrentUpdateError,
  VtuConcurrentUpdateError,
} from './vtu-concurrent-update-error';

describe('VtuConcurrentUpdateError', () => {
  it('identifies zero-match losses across module boundaries', () => {
    const loss = new VtuConcurrentUpdateError('row moved or settled');
    expect(loss).toBeInstanceOf(Error);
    expect(loss.name).toBe('VtuConcurrentUpdateError');
    expect(isVtuConcurrentUpdateError(loss)).toBe(true);
    expect(isVtuConcurrentUpdateError(new Error('row moved'))).toBe(false);
    expect(isVtuConcurrentUpdateError(null)).toBe(false);
  });
});
