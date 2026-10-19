import type { RefinementParams } from '@baci/shared/lib';
import { act, renderHook } from '@testing-library/react-native';
import { useSearchRefinements } from './use-search-refinements';

describe('committed search refinements', () => {
  it('resets criteria and route filters on a different committed query', () => {
    const write = jest.fn();
    const params: RefinementParams = {
      q: 'phone',
      brand: ['Apple'],
      maxPrice: '200000',
      sort: 'price_asc',
    };
    const { result, rerender } = renderHook(
      ({ query }: { query: string }) =>
        useSearchRefinements(query, params, write),
      { initialProps: { query: 'phone' } }
    );
    rerender({ query: 'laptop' });
    expect(result.current.criteria).toEqual({ brands: [], sort: 'relevance' });
    expect(write).toHaveBeenLastCalledWith(
      expect.objectContaining({
        q: 'laptop',
        brand: undefined,
        maxPrice: undefined,
        sort: undefined,
      })
    );
  });
  it('pauses fetching while a new route query is being restored', () => {
    const write = jest.fn();
    const { result, rerender } = renderHook(
      ({ query, params }: { query: string; params: RefinementParams }) =>
        useSearchRefinements(query, params, write),
      {
        initialProps: {
          query: 'phone',
          params: { q: 'phone' } as RefinementParams,
        },
      }
    );
    rerender({ query: 'phone', params: { q: 'laptop', brand: ['Dell'] } });
    expect(result.current.isRestoring).toBe(true);
    rerender({ query: 'laptop', params: { q: 'laptop', brand: ['Dell'] } });
    expect(result.current.isRestoring).toBe(false);
    expect(result.current.criteria.brands).toEqual(['Dell']);
    expect(write).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { q: ['phone', 'laptop'] },
  ])('pauses old results for a cleared or invalid route %j', (params) => {
    const { result, rerender } = renderHook(
      ({ route }: { route: RefinementParams }) =>
        useSearchRefinements('phone', route, jest.fn()),
      { initialProps: { route: { q: 'phone' } as RefinementParams } }
    );
    rerender({ route: params });
    expect(result.current.isRestoring).toBe(true);
  });
  it('restores explicit route filters and keeps equivalent query submissions', () => {
    const write = jest.fn();
    const { result, rerender } = renderHook(
      ({ query, params }: { query: string; params: RefinementParams }) =>
        useSearchRefinements(query, params, write),
      {
        initialProps: {
          query: 'phone',
          params: { q: 'phone', brand: ['Apple'] } as RefinementParams,
        },
      }
    );
    rerender({ query: 'PHONE', params: { q: 'phone', brand: ['Apple'] } });
    expect(result.current.criteria.brands).toEqual(['Apple']);
    rerender({
      query: 'laptop',
      params: { q: 'laptop', brand: ['Dell'], sort: 'newest' },
    });
    expect(result.current.criteria).toEqual({
      brands: ['Dell'],
      sort: 'newest',
    });
    act(() => result.current.commit({ sort: 'newest', brands: ['Dell'] }));
    expect(write).not.toHaveBeenCalled();
  });
});
