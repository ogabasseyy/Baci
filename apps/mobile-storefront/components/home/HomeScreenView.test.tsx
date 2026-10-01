import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { SharedValue } from 'react-native-reanimated';
import type { Block } from '@/types/blocks';
import { HomeScreenView } from './HomeScreenView';

const mockSetNavigationBarStyle = jest.fn();
let mockColorScheme: 'dark' | 'light' = 'light';

jest.mock('expo-navigation-bar', () => ({
  setStyle: (...args: unknown[]) => mockSetNavigationBarStyle(...args),
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => mockColorScheme,
}));

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

describe('HomeScreenView', () => {
  beforeEach(() => {
    mockSetNavigationBarStyle.mockClear();
    mockColorScheme = 'light';
  });

  it('renders the loading shell while initial content loads', () => {
    render(<HomeScreenView {...createProps()} isConfigLoading={true} />);

    expect(screen.getByText('Header')).toBeTruthy();
    expect(screen.getByText('Hero skeleton')).toBeTruthy();
    expect(screen.getByText('Grid skeleton')).toBeTruthy();
    expect(screen.queryByTestId('home-feed-list')).toBeNull();
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
});
