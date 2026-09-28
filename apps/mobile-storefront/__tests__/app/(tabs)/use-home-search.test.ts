import { act, renderHook } from '@testing-library/react-native';
import { Keyboard } from 'react-native';
import { useHomeSearchControls } from '@/hooks/use-home-search';

const mockRouterPush = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
  },
}));

describe('useHomeSearchControls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function setup(isFocused = true) {
    const onSearchOpen = jest.fn();
    const utils = renderHook(
      (props: { isFocused: boolean; onSearchOpen: () => void }) =>
        useHomeSearchControls(props),
      { initialProps: { isFocused, onSearchOpen } }
    );
    return { onSearchOpen, ...utils };
  }

  it('opens the search overlay through the shared visibility value', () => {
    const { onSearchOpen, result } = setup();

    act(() => {
      result.current.handleSearch();
    });

    expect(result.current.searchVisible).toBe(true);
    expect(result.current.searchVisibleShared.get()).toBe(true);
    expect(onSearchOpen).toHaveBeenCalled();
  });

  it('submits valid queries to the search screen and cleans up focus', () => {
    const dismissSpy = jest.spyOn(Keyboard, 'dismiss');
    const { result } = setup();

    act(() => {
      result.current.handleSearch();
      result.current.handleSearchQueryChange('iphone');
    });
    act(() => {
      result.current.handleSearchSubmit();
    });

    expect(mockRouterPush).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/search',
      params: { q: 'iphone' },
    });
    expect(result.current.searchVisible).toBe(false);
    expect(dismissSpy).toHaveBeenCalled();
    dismissSpy.mockRestore();
  });

  it('keeps short queries in the input with a minimum-length hint', () => {
    const { result } = setup();

    act(() => {
      result.current.handleSearch();
      result.current.handleSearchQueryChange('i');
    });
    act(() => {
      result.current.handleSearchSubmit();
    });

    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(result.current.searchQuery).toBe('i');
    expect(result.current.showSearchMinLengthHint).toBe(true);
    expect(result.current.searchVisible).toBe(true);
  });

  it('prevents a second push while navigation is in flight', () => {
    const { result, rerender } = setup();

    act(() => {
      result.current.handleSearch();
      result.current.handleSearchQueryChange('iphone');
    });
    act(() => {
      result.current.handleSearchSubmit();
      result.current.handleSearchSubmit();
    });

    expect(mockRouterPush).toHaveBeenCalledTimes(1);

    rerender({ isFocused: false, onSearchOpen: jest.fn() });
    rerender({ isFocused: true, onSearchOpen: jest.fn() });

    act(() => {
      result.current.handleSearch();
      result.current.handleSearchQueryChange('galaxy');
    });
    act(() => {
      result.current.handleSearchSubmit();
    });

    expect(mockRouterPush).toHaveBeenCalledTimes(2);
  });
});
