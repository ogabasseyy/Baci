import { renderHook } from '@testing-library/react';
import { useContext } from 'react';
import { describe, expect, it } from 'vitest';
import { SearchComparisonIntentContext } from './search-comparison-intent-context';

describe('SearchComparisonIntentContext', () => {
  it('defaults to idle with a no-op activate', () => {
    const { result } = renderHook(() =>
      useContext(SearchComparisonIntentContext)
    );
    expect(result.current.active).toBe(false);
    expect(() => result.current.activate()).not.toThrow();
    expect(result.current.active).toBe(false);
  });
});
