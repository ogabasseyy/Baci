import { describe, expect, it } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Keyboard } from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import { getHomeContentBottomPadding } from '@/constants/layout';
import {
  createTemplateConfig,
  HomeScreen,
  mockGetTemplateConfig,
  mockHomeFeedList,
  mockInvalidateQueries,
  mockRecordPerformanceSurface,
  mockResetQueries,
  mockRouterPush,
  mockSearchDropdown,
  mockUseIsFocused,
  setupHomeScreenTestState,
} from '../../../test-support/(tabs)/index.test-utils';

function lastFeedProps() {
  return mockHomeFeedList.mock.calls.at(-1)?.[0];
}

function scrollHomeFeed(offsetY: number) {
  fireEvent.scroll(screen.getByTestId('home-feed-list'), {
    nativeEvent: {
      contentOffset: { x: 0, y: offsetY },
      contentSize: { width: 375, height: 1000 },
      layoutMeasurement: { width: 375, height: 300 },
    },
  });
}

describe('HomeScreen', () => {
  setupHomeScreenTestState();

  it('renders the virtualized home feed with bottom clearance for overlays', () => {
    render(<HomeScreen />);

    expect(screen.getByTestId('home-feed-list')).toBeTruthy();
    // Hero + injected JustLaunched + CategoryRail + ProductGrid.
    expect(screen.getAllByTestId('block-renderer')).toHaveLength(4);
    expect(screen.getByText('JustLaunched')).toBeTruthy();
    expect(lastFeedProps()?.contentBottomPadding).toBe(
      getHomeContentBottomPadding(34, true)
    );
  });

  it('attributes the focused home performance surface', () => {
    render(<HomeScreen />);

    expect(mockRecordPerformanceSurface).toHaveBeenCalledWith('home', {
      template_id: 'default',
    });
  });

  it('ends the home performance trace on focus loss and unmount', () => {
    const endTraces: jest.Mock[] = [];
    mockRecordPerformanceSurface.mockImplementation(() => {
      const endTrace = jest.fn();
      endTraces.push(endTrace);
      return endTrace;
    });
    const { rerender, unmount } = render(<HomeScreen />);
    const focusedEndTrace = endTraces.at(-1);

    mockUseIsFocused.mockReturnValue(false);
    rerender(<HomeScreen />);

    expect(focusedEndTrace).toHaveBeenCalledTimes(1);

    mockUseIsFocused.mockReturnValue(true);
    rerender(<HomeScreen />);
    const unmountedEndTrace = endTraces.at(-1);
    unmount();

    expect(unmountedEndTrace).toHaveBeenCalledTimes(1);
  });

  it('uses tab-bar clearance only when the chat widget is disabled', () => {
    const template = createTemplateConfig();

    mockGetTemplateConfig.mockReturnValue({
      ...template,
      features: { ...template.features, chatWidget: false },
    });

    render(<HomeScreen />);

    expect(lastFeedProps()?.contentBottomPadding).toBe(
      getHomeContentBottomPadding(34, false)
    );
  });

  it('passes scroll state to the header when the feed scrolls', () => {
    render(<HomeScreen />);

    expect(screen.getByTestId('mock-header')).toHaveTextContent('Header false');

    fireEvent.scroll(screen.getByTestId('home-feed-list'), {
      nativeEvent: {
        contentOffset: { x: 0, y: 12 },
        contentSize: { width: 375, height: 1000 },
        layoutMeasurement: { width: 375, height: 300 },
      },
    });

    expect(screen.getByTestId('mock-header')).toHaveTextContent('Header true');
  });

  it('does not restart a header animation until its visibility target changes', () => {
    const withTimingSpy = jest.spyOn(Reanimated, 'withTiming');
    render(<HomeScreen />);

    scrollHomeFeed(30);
    scrollHomeFeed(60);
    scrollHomeFeed(90);

    expect(withTimingSpy.mock.calls.map(([target]) => target)).toEqual([0]);

    scrollHomeFeed(65);
    scrollHomeFeed(40);
    scrollHomeFeed(16);

    expect(withTimingSpy.mock.calls.map(([target]) => target)).toEqual([0, 1]);

    fireEvent.press(screen.getByTestId('mock-header-search'));
    scrollHomeFeed(120);

    expect(withTimingSpy.mock.calls.map(([target]) => target)).toEqual([0, 1]);
  });

  it('submits the header query to the search screen and closes the dropdown', () => {
    const dismissSpy = jest.spyOn(Keyboard, 'dismiss');
    render(<HomeScreen />);

    fireEvent.press(screen.getByTestId('mock-header-search'));
    fireEvent.press(screen.getByTestId('mock-header-query-type'));
    fireEvent.press(screen.getByTestId('mock-header-submit'));

    expect(mockRouterPush).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/search',
      params: { q: 'iphone' },
    });
    expect(mockSearchDropdown.mock.calls.at(-1)?.[0]).toMatchObject({
      isVisible: false,
    });
    expect(dismissSpy).toHaveBeenCalled();
    dismissSpy.mockRestore();
  });

  it('routes the dropdown "See all results" action to the search screen', () => {
    render(<HomeScreen />);

    fireEvent.press(screen.getByTestId('mock-header-search'));
    fireEvent.press(screen.getByTestId('mock-header-query-type'));

    const onSeeAllResults =
      mockSearchDropdown.mock.calls.at(-1)?.[0]?.onSeeAllResults;
    expect(onSeeAllResults).toEqual(expect.any(Function));

    act(() => {
      onSeeAllResults?.('galaxy s24');
    });

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/search',
      params: { q: 'galaxy s24' },
    });
  });

  it('keeps short queries in the input with a minimum-length hint', () => {
    render(<HomeScreen />);

    fireEvent.press(screen.getByTestId('mock-header-search'));
    fireEvent.press(screen.getByTestId('mock-header-query-type-short'));
    fireEvent.press(screen.getByTestId('mock-header-submit'));

    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(screen.getByTestId('mock-header-query')).toHaveTextContent('i');
    expect(mockSearchDropdown.mock.calls.at(-1)?.[0]).toMatchObject({
      isVisible: true,
      showMinLengthHint: true,
    });
  });

  it('prevents a second search push while navigation is in flight', () => {
    const { rerender } = render(<HomeScreen />);

    fireEvent.press(screen.getByTestId('mock-header-search'));
    fireEvent.press(screen.getByTestId('mock-header-query-type'));
    fireEvent.press(screen.getByTestId('mock-header-submit'));
    fireEvent.press(screen.getByTestId('mock-header-submit'));

    expect(mockRouterPush).toHaveBeenCalledTimes(1);

    // Returning focus to home re-arms submission.
    mockUseIsFocused.mockReturnValue(false);
    rerender(<HomeScreen />);
    mockUseIsFocused.mockReturnValue(true);
    rerender(<HomeScreen />);

    fireEvent.press(screen.getByTestId('mock-header-search'));
    fireEvent.press(screen.getByTestId('mock-header-query-type'));
    fireEvent.press(screen.getByTestId('mock-header-submit'));

    expect(mockRouterPush).toHaveBeenCalledTimes(2);
  });

  it('resets the products query and invalidates categories on pull-to-refresh', async () => {
    render(<HomeScreen />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('home-feed-refresh'));
      await Promise.resolve();
    });

    // Partial prefix keys match useProducts' ['products', merchantId, options].
    expect(mockResetQueries).toHaveBeenCalledWith({
      queryKey: ['products', 'merchant-1'],
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['categories', 'merchant-1'],
    });
  });
});
