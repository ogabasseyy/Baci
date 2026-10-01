import { describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { useSearchRouteQuerySync } from './use-search-route-query-sync';

describe('useSearchRouteQuerySync', () => {
  function setup(initialParam: string | string[] | undefined) {
    const onApplyRouteQuery = jest.fn();
    const onClearRouteQuery = jest.fn();
    const rendered = renderHook(
      ({
        routeQueryParam,
      }: {
        routeQueryParam: string | string[] | undefined;
      }) =>
        useSearchRouteQuerySync({
          routeQueryParam,
          onApplyRouteQuery: onApplyRouteQuery as (query: string) => void,
          onClearRouteQuery: onClearRouteQuery as () => void,
        }),
      { initialProps: { routeQueryParam: initialParam } }
    );
    return { ...rendered, onApplyRouteQuery, onClearRouteQuery };
  }

  it('applies a valid mount query once', () => {
    const { onApplyRouteQuery, onClearRouteQuery } = setup('iphone');

    expect(onApplyRouteQuery).toHaveBeenCalledTimes(1);
    expect(onApplyRouteQuery).toHaveBeenCalledWith('iphone');
    expect(onClearRouteQuery).not.toHaveBeenCalled();
  });

  it('stays idle when mounting without a valid query', () => {
    const { onApplyRouteQuery, onClearRouteQuery } = setup(undefined);

    expect(onApplyRouteQuery).not.toHaveBeenCalled();
    expect(onClearRouteQuery).not.toHaveBeenCalled();
  });

  it('applies a new valid query on an update without reapplying the same one', () => {
    const { onApplyRouteQuery, rerender } = setup('iphone');

    rerender({ routeQueryParam: 'galaxy' });

    expect(onApplyRouteQuery).toHaveBeenCalledTimes(2);
    expect(onApplyRouteQuery).toHaveBeenLastCalledWith('galaxy');

    rerender({ routeQueryParam: 'galaxy' });

    expect(onApplyRouteQuery).toHaveBeenCalledTimes(2);
  });

  it('clears when an applied query becomes invalid', () => {
    const { onApplyRouteQuery, onClearRouteQuery, rerender } = setup('iphone');

    rerender({ routeQueryParam: undefined });

    expect(onClearRouteQuery).toHaveBeenCalledTimes(1);
    expect(onApplyRouteQuery).toHaveBeenCalledTimes(1);
  });

  it('clears on a raw transition to invalid even with no applied query', () => {
    const { onClearRouteQuery, rerender } = setup(undefined);

    rerender({ routeQueryParam: 'i' });

    expect(onClearRouteQuery).toHaveBeenCalledTimes(1);

    rerender({ routeQueryParam: ['shoes', 'bags'] });

    expect(onClearRouteQuery).toHaveBeenCalledTimes(2);
  });

  it('treats a short string and its same-content array as different params', () => {
    // Both are invalid, so only the type-aware raw comparison can observe
    // this transition (a naive String() comparison sees 'a' === 'a').
    const { onClearRouteQuery, rerender } = setup('a');
    expect(onClearRouteQuery).not.toHaveBeenCalled();

    rerender({ routeQueryParam: ['a'] });

    expect(onClearRouteQuery).toHaveBeenCalledTimes(1);
  });
});
