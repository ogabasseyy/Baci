import { describe, expect, it } from 'vitest';
import { formatSemanticError } from './format-semantic-error';

describe('formatSemanticError', () => {
  it('returns the message from an Error', () => {
    expect(formatSemanticError(new Error('semantic step failed'))).toBe(
      'semantic step failed'
    );
  });

  it('converts a non-Error value to a string', () => {
    expect(formatSemanticError('runner unavailable')).toBe(
      'runner unavailable'
    );
  });
});
