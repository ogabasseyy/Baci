import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useSearchScreenQuery } from './use-search-screen-query';

function setup(routeQueryParam: string | string[] | undefined = undefined) {
  const props = {
    isFocused: true,
    routeQueryParam,
    routeParams: {},
    writeParams: jest.fn(),
    evaluateCommit: jest.fn(() => true),
    noteQueryChange: jest.fn(),
    clearHint: jest.fn(),
    saveToHistory: jest.fn(),
  };
  const rendered = renderHook(() => useSearchScreenQuery(props));
  return { ...rendered, props };
}

describe('useSearchScreenQuery', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  it('starts idle without a route query', () => {
    const { result } = setup();
    expect(result.current.query).toBe('');
    expect(result.current.hasSearchQuery).toBe(false);
    expect(result.current.refinements).toEqual({
      brands: [],
      sort: 'relevance',
    });
  });
  it('debounces typed queries into an auto-commit', () => {
    const { result } = setup();
    act(() => {
      result.current.handleQueryChange('iphone');
    });
    expect(result.current.query).toBe('iphone');
    expect(result.current.debouncedQuery).toBe('');
    act(() => {
      jest.advanceTimersByTime(250);
    });
    expect(result.current.debouncedQuery).toBe('iphone');
    expect(result.current.hasSearchQuery).toBe(true);
  });
  it('bounds commits and records history once', () => {
    const { result, props } = setup();
    act(() => {
      result.current.commitSearchQuery(`  ${'x'.repeat(120)}  `);
    });
    expect(result.current.debouncedQuery).toBe('x'.repeat(100));
    expect(props.saveToHistory).toHaveBeenCalledWith('x'.repeat(100));
  });
  it('applies assistance proposals through route params', () => {
    const { result, props } = setup();
    act(() => {
      result.current.applyAssistance({
        query: 'iphone',
        explanation: 'Used within budget.',
        filters: { condition: 'used', maxPrice: 500000 },
      });
    });
    expect(props.writeParams).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'iphone',
        condition: 'used',
        maxPrice: '500000',
      })
    );
  });
});
