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

  it('truncates over-long queries to the shared maximum before pushing', () => {
    const { result } = setup();
    const longQuery = 'a'.repeat(150);

    act(() => {
      result.current.handleSearch();
      result.current.handleSearchQueryChange(longQuery);
    });
    act(() => {
      result.current.handleSearchSubmit();
    });

    expect(mockRouterPush).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/search',
      params: { q: 'a'.repeat(100) },
    });
  });

  it('bounds a pasted query through submit and back navigation', () => {
    const { result, rerender } = setup();
    const pastedQuery = 'a'.repeat(150);
    const boundedQuery = 'a'.repeat(100);

    // Paste: acceptance bounds the controlled state itself, so the input,
    // dropdown suggestions, and see-all label never see the excess.
    act(() => {
      result.current.handleSearch();
      result.current.handleSearchQueryChange(pastedQuery);
    });
    expect(result.current.searchQuery).toBe(boundedQuery);

    // Submit: the route param matches the displayed term.
    act(() => {
      result.current.handleSearchSubmit();
    });
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/search',
      params: { q: boundedQuery },
    });

    // Return: back navigation re-arms submission and keeps displaying the
    // same bounded term — never the original over-long paste.
    rerender({ isFocused: false, onSearchOpen: jest.fn() });
    rerender({ isFocused: true, onSearchOpen: jest.fn() });
    expect(result.current.searchQuery).toBe(boundedQuery);

    act(() => {
      result.current.handleSearch();
      result.current.handleSearchSubmit();
    });
    expect(mockRouterPush).toHaveBeenCalledTimes(2);
    expect(mockRouterPush).toHaveBeenLastCalledWith({
      pathname: '/search',
      params: { q: boundedQuery },
    });
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

  it('keeps punctuation-only queries in the input instead of navigating', () => {
    const { result } = setup();

    act(() => {
      result.current.handleSearch();
      result.current.handleSearchQueryChange('!!');
    });
    act(() => {
      result.current.handleSearchSubmit();
    });

    // Passes the length check but normalizes to nothing, which the fetch
    // would resolve to zero matches: stay put with guidance.
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(result.current.searchQuery).toBe('!!');
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
