import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useImeiTierSelection } from './use-imei-tier-selection';

const availability = vi.hoisted(() => ({
  keys: null as import('@baci/shared/imei').ImeiServiceTierKey[] | null,
}));
vi.mock('./use-imei-runtime-availability', () => ({
  useImeiRuntimeAvailability: () => ({
    availableTierKeys: availability.keys,
    failed: false,
    loading: false,
    retry: vi.fn(),
  }),
}));
beforeEach(() => {
  availability.keys = null;
});

describe('useImeiTierSelection', () => {
  it('defaults to the smartphone tab, apple brand, and the recommended tier', () => {
    const { result } = renderHook(() => useImeiTierSelection());

    expect(result.current.device).toBe('smartphone');
    expect(result.current.brand).toBe('apple');
    expect(result.current.selectedTier).toBe('full');
    // 'full' is a hard-typed 'imei' tier, so resolveInputIdentifier keeps
    // 'imei' even though the smartphone tab's own default is 'both'.
    expect(result.current.identifier).toBe('imei');
    expect(result.current.displayedTierKeys).toEqual([
      'full',
      'basic',
      'blacklist',
      'carrier',
    ]);
  });

  it('resets tier, brand, and imei when switching device tabs', () => {
    const { result } = renderHook(() => useImeiTierSelection());

    act(() => {
      result.current.onSelectTier('blacklist');
      result.current.onChangeImei('490154203237518');
    });
    expect(result.current.imei).toBe('490154203237518');

    act(() => {
      result.current.onSelectDevice('laptop');
    });

    expect(result.current.device).toBe('laptop');
    expect(result.current.brand).toBe('apple');
    expect(result.current.selectedTier).toBe('macIcloud');
    expect(result.current.identifier).toBe('serial');
    expect(result.current.imei).toBe('');
  });

  it('clears the imei input when switching to a tier with a different resolved identifier', () => {
    const { result } = renderHook(() => useImeiTierSelection());

    act(() => {
      result.current.onChangeImei('490154203237518');
    });
    expect(result.current.imei).toBe('490154203237518');

    act(() => {
      // 'full' is identifier 'imei'; 'serialInfo' is identifier 'serial' — a
      // real identifier change on the same (smartphone) device.
      result.current.onToggleServices();
    });
    act(() => {
      result.current.onSelectTier('serialInfo');
    });

    expect(result.current.imei).toBe('');
    expect(result.current.identifier).toBe('serial');
  });

  it('keeps the imei input when switching between two tiers with the same resolved identifier', () => {
    const { result } = renderHook(() => useImeiTierSelection());

    act(() => {
      result.current.onChangeImei('490154203237518');
    });

    act(() => {
      // 'full' and 'blacklist' are both identifier 'imei' on the smartphone tab.
      result.current.onSelectTier('blacklist');
    });

    expect(result.current.imei).toBe('490154203237518');
  });

  it('auto-reselects the tier when the current tier is not visible for the new brand', () => {
    const { result } = renderHook(() => useImeiTierSelection());

    expect(result.current.selectedTier).toBe('full');

    act(() => {
      result.current.onSelectBrand('samsung');
    });

    expect(result.current.brand).toBe('samsung');
    expect(result.current.selectedTier).not.toBe('full');
    expect(result.current.displayedTierKeys).toContain(
      result.current.selectedTier
    );
  });

  it('shows the "show all services" toggle only when there are extra tiers to reveal', () => {
    const { result } = renderHook(() => useImeiTierSelection());

    expect(result.current.canToggleServices).toBe(true);

    act(() => {
      result.current.onToggleServices();
    });

    expect(result.current.showAllServices).toBe(true);
    expect(result.current.displayedTierKeys.length).toBeGreaterThan(4);
  });

  it('normalizes typed input according to the current identifier type', () => {
    const { result } = renderHook(() => useImeiTierSelection());

    act(() => {
      // 'full' resolves to identifier 'imei': digits only.
      result.current.onChangeImei('abc-123 def456');
    });
    expect(result.current.imei).toBe('123456');

    act(() => {
      // 'serialInfo' resolves to identifier 'serial': alphanumeric, uppercased.
      result.current.onToggleServices();
    });
    act(() => {
      result.current.onSelectTier('serialInfo');
    });
    act(() => {
      result.current.onChangeImei('abc-123 def');
    });
    expect(result.current.imei).toBe('ABC123DEF');
  });

  it('clears the imei input via onClearImei', () => {
    const { result } = renderHook(() => useImeiTierSelection());

    act(() => {
      result.current.onChangeImei('490154203237518');
    });
    expect(result.current.imei).not.toBe('');

    act(() => {
      result.current.onClearImei();
    });

    expect(result.current.imei).toBe('');
  });

  it('uses the serial identifier, activation default, and primary tiers for Watch', () => {
    const { result } = renderHook(() => useImeiTierSelection());

    act(() => {
      result.current.onSelectDevice('watch');
    });

    expect(result.current.device).toBe('watch');
    expect(result.current.identifier).toBe('serial');
    expect(result.current.selectedTier).toBe('activation');
    expect(result.current.displayedTierKeys).toEqual([
      'activation',
      'repairEligibility',
      'gsxPremium',
    ]);
  });
});

describe('runtime IMEI tier selection', () => {
  it('hides eSIM until advertised and clears its selection after capabilities are revoked', () => {
    const { result, rerender } = renderHook(() => useImeiTierSelection());
    act(() => result.current.onToggleServices());
    expect(result.current.displayedTierKeys).not.toContain('esimCompatibility');
    availability.keys = ['full', 'esimCompatibility'];
    rerender();
    expect(result.current.displayedTierKeys).toContain('esimCompatibility');
    act(() => result.current.onSelectTier('esimCompatibility'));
    expect(result.current.selectedTier).toBe('esimCompatibility');
    availability.keys = [];
    rerender();
    expect(result.current.displayedTierKeys).toEqual([]);
    expect(result.current.selectedTier).toBeNull();
    availability.keys = ['full', 'esimCompatibility'];
    rerender();
    expect(result.current.selectedTier).toBeNull();
  });
  it('still applies brand and device filtering to an advertised eSIM capability', () => {
    availability.keys = ['full', 'esimCompatibility', 'macIcloud'];
    const { result } = renderHook(() => useImeiTierSelection());
    act(() => result.current.onToggleServices());
    act(() => result.current.onSelectTier('esimCompatibility'));
    act(() => result.current.onSelectBrand('samsung'));
    expect(result.current.displayedTierKeys).not.toContain('esimCompatibility');
    expect(result.current.selectedTier).not.toBe('esimCompatibility');
    act(() => result.current.onSelectDevice('laptop'));
    expect(result.current.displayedTierKeys).not.toContain('esimCompatibility');
    expect(result.current.selectedTier).not.toBe('esimCompatibility');
  });
});
