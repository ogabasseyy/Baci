import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { NavigationContext } from 'expo-router/react-navigation';
import type { ComponentProps } from 'react';
import { Platform } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import type { Block } from '@/types/blocks';
import { HomeScreenView } from './HomeScreenView';

const mockSetNavigationBarStyle = jest.fn();
let mockColorScheme: 'dark' | 'light' = 'light';
const originalPlatformOS = Platform.OS;
type NavigationContextValue = NonNullable<
  ComponentProps<typeof NavigationContext.Provider>['value']
>;
type FocusEventName = 'blur' | 'focus';

function setPlatformOS(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: os,
  });
}

jest.mock('expo-navigation-bar', () => ({
  setStyle: (...args: unknown[]) => mockSetNavigationBarStyle(...args),
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => mockColorScheme,
}));

jest.mock('expo-image', () => {
  const { Text } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    Image: () => <Text>Elite texture</Text>,
  };
});

jest.mock('@/components/storefront/GadgetPattern', () => {
  const { Text } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    GadgetPattern: ({
      color,
      colorScheme,
    }: {
      color?: string;
      colorScheme?: string;
    }) => (
      <Text>{`Gadget pattern ${color ?? 'default'} ${colorScheme ?? 'system'}`}</Text>
    ),
  };
});

jest.mock('expo-router', () => ({
  Stack: {
    Screen: () => null,
  },
}));

jest.mock('@/components/OfflineNotice', () => {
  const { Text } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    OfflineNotice: ({ message }: { message?: string }) => (
      <Text>{message ?? 'Offline cached content'}</Text>
    ),
  };
});

jest.mock('./HomeFeedList', () => {
  const { Pressable, Text, View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    HomeFeedList: ({
      blocks,
      onRefresh,
    }: {
      blocks: Block[];
      onRefresh: () => void;
    }) => (
      <View testID="home-feed-list">
        {blocks.map((block) => (
          <View key={block.props.id}>
            <Text>{`Block ${block.type}`}</Text>
            {block.type === 'CategoryRail' ? <Text>Services</Text> : null}
          </View>
        ))}
        <Pressable testID="home-feed-refresh" onPress={onRefresh}>
          <Text>Refresh</Text>
        </Pressable>
      </View>
    ),
  };
});

jest.mock('@/components/storefront/Header', () => {
  const { Text } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    Header: ({ onSearchPress }: { onSearchPress?: () => void }) => (
      <Text onPress={onSearchPress}>Header</Text>
    ),
  };
});

jest.mock('@/components/storefront/HomeServiceCards', () => {
  const { Text } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    HomeServiceCards: () => <Text>Services</Text>,
  };
});

jest.mock('@/components/storefront/SearchDropdown', () => {
  const { Text } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    SearchDropdown: ({
      isVisible,
      onClose,
      onSeeAllResults,
      query,
      showMinLengthHint,
    }: {
      isVisible: boolean;
      onClose: () => void;
      onSeeAllResults?: (query: string) => void;
      query?: string;
      showMinLengthHint?: boolean;
    }) =>
      isVisible ? (
        <>
          <Text onPress={onClose}>Search results</Text>
          <Text
            testID="mock-see-all-results"
            onPress={() => onSeeAllResults?.(query ?? '')}
          >
            Mock see all results
          </Text>
          {showMinLengthHint ? (
            <Text testID="mock-min-length-hint">Mock min length hint</Text>
          ) : null}
        </>
      ) : null,
  };
});

jest.mock('@/components/ui/Skeleton', () => {
  const { Text } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    HeroSkeleton: () => <Text>Hero skeleton</Text>,
    ProductGridSkeleton: () => <Text>Grid skeleton</Text>,
  };
});

jest.mock('@/components/ui/SnowEffect', () => {
  const { Text } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    SnowEffect: () => <Text>Snow effect</Text>,
  };
});

const blocks: Block[] = [
  { type: 'CategoryRail', props: { id: 'categories' } },
  {
    type: 'ProductGrid',
    props: { id: 'products', title: 'Featured Products' },
  },
];

function createProps() {
  return {
    backgroundColor: '#ffffff',
    blackColor: '#000000',
    blocks,
    contentBottomPadding: 84,
    hasPageConfig: true,
    headerVisibility: { value: 1 } as unknown as SharedValue<number>,
    isConfigLoading: false,
    isElite: false,
    isError: false,
    isOnline: true,
    isScrolled: false,
    onCategorySelect: jest.fn(),
    onHeaderLayout: jest.fn(),
    onListScroll: jest.fn(),
    onRefresh: jest.fn(async () => undefined),
    onSearch: jest.fn(),
    onSearchCancel: jest.fn(),
    onSearchQueryChange: jest.fn(),
    onSearchSubmit: jest.fn(),
    onSeeAllResults: jest.fn(),
    primaryColor: '#0ea5e9',
    primaryProductGridIndex: 1,
    refreshing: false,
    resolvedHeaderHeight: 150,
    searchQuery: '',
    searchVisible: false,
    selectedCategoryId: null,
    shouldRenderDecorations: true,
    showSearchMinLengthHint: false,
  };
}

function createNavigationMock(initialFocused = true) {
  let focused = initialFocused;
  const listeners: Record<FocusEventName, Array<() => void>> = {
    blur: [],
    focus: [],
  };
  const navigation = {
    addListener: jest.fn((eventName: FocusEventName, listener: () => void) => {
      listeners[eventName].push(listener);
      return () => {
        listeners[eventName] = listeners[eventName].filter(
          (currentListener) => currentListener !== listener
        );
      };
    }),
    isFocused: jest.fn(() => focused),
  } as unknown as NavigationContextValue;

  return {
    emit: (eventName: FocusEventName) => {
      focused = eventName === 'focus';
      act(() => {
        for (const listener of listeners[eventName]) {
          listener();
        }
      });
    },
    navigation,
  };
}

describe('HomeScreenView', () => {
  beforeEach(() => {
    mockSetNavigationBarStyle.mockClear();
    mockColorScheme = 'light';
    setPlatformOS(originalPlatformOS);
  });

  afterEach(() => {
    setPlatformOS(originalPlatformOS);
  });

  it('renders the loading shell while initial content loads', () => {
    render(<HomeScreenView {...createProps()} isConfigLoading={true} />);

    expect(screen.getByText('Header')).toBeTruthy();
    expect(screen.getByText('Hero skeleton')).toBeTruthy();
    expect(screen.getByText('Grid skeleton')).toBeTruthy();
    expect(screen.queryByTestId('home-feed-list')).toBeNull();
  });

  it('keeps the root navigation bar style while the light loading shell is visible', () => {
    setPlatformOS('android');

    render(<HomeScreenView {...createProps()} isConfigLoading={true} />);

    expect(mockSetNavigationBarStyle).toHaveBeenLastCalledWith('dark');
  });

  it('renders home blocks and delegates header and refresh interactions', () => {
    const onSearch = jest.fn();
    const onRefresh = jest.fn(async () => undefined);

    render(
      <HomeScreenView
        {...createProps()}
        onRefresh={onRefresh}
        onSearch={onSearch}
      />
    );

    expect(screen.getByText('Block CategoryRail')).toBeTruthy();
    expect(screen.getByText('Services')).toBeTruthy();
    expect(screen.getByText('Block ProductGrid')).toBeTruthy();

    fireEvent.press(screen.getByText('Header'));
    expect(onSearch).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('home-feed-refresh'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('uses the active merchant theme color for decorative and refresh affordances', () => {
    render(<HomeScreenView {...createProps()} primaryColor="#22c55e" />);

    expect(screen.getByText('Gadget pattern #22c55e light')).toBeTruthy();
  });

  it('renders only one shared backdrop for the elite home surface', () => {
    render(<HomeScreenView {...createProps()} isElite={true} />);

    expect(screen.getAllByText(/Gadget pattern/)).toHaveLength(1);
    expect(screen.getByText('Gadget pattern default dark')).toBeTruthy();
  });

  it('renders the online error notice for an unsuccessful page request', () => {
    render(<HomeScreenView {...createProps()} isError={true} />);

    expect(screen.getByText('Failed to load content')).toBeTruthy();
  });

  it('shows cached-content feedback and the elite backdrop while offline', () => {
    render(
      <HomeScreenView {...createProps()} isElite={true} isOnline={false} />
    );

    expect(screen.getByText('Offline cached content')).toBeTruthy();
    expect(screen.getAllByText(/Gadget pattern/)).toHaveLength(1);
  });

  it('keeps heavy decorative layers deferred while rendering the elite backdrop immediately', () => {
    render(
      <HomeScreenView
        {...createProps()}
        isElite={true}
        shouldRenderDecorations={false}
      />
    );

    expect(screen.getByText('Block CategoryRail')).toBeTruthy();
    expect(screen.getByText('Gadget pattern default dark')).toBeTruthy();
    expect(screen.queryByText('Snow effect')).toBeNull();
  });

  it('delegates closing the visible search overlay', () => {
    const onSearchCancel = jest.fn();

    render(
      <HomeScreenView
        {...createProps()}
        onSearchCancel={onSearchCancel}
        searchVisible={true}
      />
    );

    fireEvent.press(screen.getByText('Search results'));

    expect(onSearchCancel).toHaveBeenCalledTimes(1);
  });

  it('restores the root navigation bar style when the Home tab loses focus', () => {
    setPlatformOS('android');
    const { emit, navigation } = createNavigationMock(true);

    const props = createProps();
    render(
      <NavigationContext.Provider value={navigation}>
        <HomeScreenView {...props} />
      </NavigationContext.Provider>
    );

    expect(mockSetNavigationBarStyle).toHaveBeenLastCalledWith('light');

    emit('blur');

    expect(mockSetNavigationBarStyle).toHaveBeenLastCalledWith('dark');

    emit('focus');

    expect(mockSetNavigationBarStyle).toHaveBeenLastCalledWith('light');
  });

  it('reapplies light Home navigation bar buttons when the color scheme changes', () => {
    setPlatformOS('android');
    const { navigation } = createNavigationMock(true);

    const { rerender } = render(
      <NavigationContext.Provider value={navigation}>
        <HomeScreenView {...createProps()} />
      </NavigationContext.Provider>
    );

    expect(mockSetNavigationBarStyle).toHaveBeenLastCalledWith('light');

    mockColorScheme = 'dark';
    rerender(
      <NavigationContext.Provider value={navigation}>
        <HomeScreenView {...createProps()} />
      </NavigationContext.Provider>
    );

    expect(mockSetNavigationBarStyle).toHaveBeenLastCalledWith('light');
  });
});
