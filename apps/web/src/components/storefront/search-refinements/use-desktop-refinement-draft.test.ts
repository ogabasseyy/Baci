import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useDesktopRefinementDraft } from './use-desktop-refinement-draft';

it('keeps unsaved prices across local brand changes but discards them on history restoration', () => {
  const onHistory = vi.fn();
  const initial = {
    brands: [] as string[],
    sort: 'relevance' as const,
    maxPrice: 500,
  };
  const { result, rerender } = renderHook(
    ({ criteria }) => useDesktopRefinementDraft(criteria, onHistory),
    { initialProps: { criteria: initial } }
  );
  act(() =>
    result.current.setDesktopDraft({
      ...result.current.desktopDraft,
      maximum: '900',
    })
  );
  rerender({ criteria: { ...initial, brands: ['Apple'] } });
  expect(result.current.desktopDraft.maximum).toBe('900');
  window.history.replaceState(
    null,
    '',
    '/search?q=phone&brand=Apple&maxPrice=500'
  );
  act(() => window.dispatchEvent(new PopStateEvent('popstate')));
  expect(result.current.desktopDraft.maximum).toBe('500');
  expect(result.current.desktopDraft.brands).toEqual(['Apple']);
  expect(onHistory).toHaveBeenCalledOnce();
});
