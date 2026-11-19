import { describe, expect, it } from 'vitest';
import { normalizeClusterText } from './normalize-cluster-text';

describe('normalizeClusterText', () => {
  it('normalizes currency tokens and trims whitespace', () => {
    expect(normalizeClusterText('  ₦500k  ')).toBe('ngn 500 k');
  });

  it('handles null and undefined input gracefully', () => {
    expect(normalizeClusterText(null)).toBe('');
    expect(normalizeClusterText(undefined)).toBe('');
  });
});
