import { act, renderHook } from '@testing-library/react-native';
import { useSearchStorage } from '@/hooks/use-search-storage';

const mockStorageData: Record<string, string> = {};

jest.mock('@/lib/storage', () => ({
  syncStorage: {
    getItem: jest.fn((key: string) => mockStorageData[key] ?? null),
    setItem: jest.fn((key: string, value: string) => {
      mockStorageData[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete mockStorageData[key];
    }),
  },
}));

describe('useSearchStorage', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockStorageData)) {
      delete mockStorageData[key];
    }
    jest.clearAllMocks();
  });

  it('falls back to default searches when nothing is persisted', () => {
    const { result } = renderHook(() => useSearchStorage());

    expect(result.current.recentSearches).toEqual([
      'iPhone 15 Pro',
      'Samsung Galaxy S24',
      'AirPods Pro',
      'MacBook Air',
      'Apple Watch',
    ]);
  });

  it('loads persisted history normalized on the first render', () => {
    mockStorageData.search_history = JSON.stringify([
      'iphone',
      '  ',
      'iPhone',
      'galaxy',
    ]);

    const { result } = renderHook(() => useSearchStorage());

    expect(result.current.recentSearches).toEqual(['iphone', 'galaxy']);
  });

  it('drops normalization-empty entries persisted by older length-only builds', () => {
    mockStorageData.search_history = JSON.stringify([
      'iphone',
      '!!',
      '()',
      'galaxy',
    ]);

    const { result } = renderHook(() => useSearchStorage());

    expect(result.current.recentSearches).toEqual(['iphone', 'galaxy']);
  });

  it('refuses to persist punctuation-only terms', () => {
    const { result } = renderHook(() => useSearchStorage());

    act(() => {
      result.current.saveSearch('!!');
    });

    expect(result.current.recentSearches).not.toContain('!!');
    expect(mockStorageData.search_history ?? '').not.toContain('!!');
  });

  it('saves searches to the front with case-insensitive dedupe', () => {
    const { result } = renderHook(() => useSearchStorage());

    act(() => {
      result.current.saveSearch('galaxy');
    });
    act(() => {
      result.current.saveSearch('GALAXY');
    });
    act(() => {
      result.current.saveSearch('i');
    });
    act(() => {
      result.current.saveSearch('   ');
    });

    expect(result.current.recentSearches[0]).toBe('GALAXY');
    expect(
      result.current.recentSearches.filter(
        (term) => term.toLowerCase() === 'galaxy'
      )
    ).toHaveLength(1);
    expect(result.current.recentSearches).not.toContain('i');
    expect(JSON.parse(mockStorageData.search_history)).toEqual(
      result.current.recentSearches
    );
  });

  it('syncs a save into other mounted instances without duplicating the entry', () => {
    const home = renderHook(() => useSearchStorage());
    const results = renderHook(() => useSearchStorage());

    act(() => {
      results.result.current.saveSearch('pixel');
    });

    expect(results.result.current.recentSearches[0]).toBe('pixel');
    expect(home.result.current.recentSearches[0]).toBe('pixel');
    expect(
      JSON.parse(mockStorageData.search_history).filter(
        (term: string) => term.toLowerCase() === 'pixel'
      )
    ).toHaveLength(1);
  });

  it('syncs a clear into other mounted instances', () => {
    const home = renderHook(() => useSearchStorage());
    const results = renderHook(() => useSearchStorage());

    act(() => {
      results.result.current.saveSearch('pixel');
    });
    expect(home.result.current.recentSearches).toContain('pixel');

    act(() => {
      results.result.current.clearHistory();
    });

    expect(results.result.current.recentSearches).toEqual([]);
    expect(home.result.current.recentSearches).toEqual([]);
    expect(mockStorageData.search_history).toBeUndefined();
  });

  it('keeps the optimistic save when persistence fails without notifying', () => {
    const home = renderHook(() => useSearchStorage());
    const results = renderHook(() => useSearchStorage());
    const { syncStorage } = jest.requireMock('@/lib/storage') as {
      syncStorage: { setItem: jest.Mock };
    };
    syncStorage.setItem.mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    act(() => {
      results.result.current.saveSearch('pixel');
    });

    expect(results.result.current.recentSearches[0]).toBe('pixel');
    expect(home.result.current.recentSearches).not.toContain('pixel');
  });

  it('keeps the optimistic clear when removal fails without notifying', () => {
    const home = renderHook(() => useSearchStorage());
    const results = renderHook(() => useSearchStorage());

    act(() => {
      results.result.current.saveSearch('pixel');
    });
    expect(home.result.current.recentSearches).toContain('pixel');

    const { syncStorage } = jest.requireMock('@/lib/storage') as {
      syncStorage: { removeItem: jest.Mock };
    };
    syncStorage.removeItem.mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    act(() => {
      results.result.current.clearHistory();
    });

    expect(results.result.current.recentSearches).toEqual([]);
    expect(home.result.current.recentSearches).toContain('pixel');
  });

  it('stops syncing after an instance unmounts', () => {
    const home = renderHook(() => useSearchStorage());
    const results = renderHook(() => useSearchStorage());

    home.unmount();

    act(() => {
      results.result.current.saveSearch('pixel');
    });

    expect(results.result.current.recentSearches[0]).toBe('pixel');
  });
});
