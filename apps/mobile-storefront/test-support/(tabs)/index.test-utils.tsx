import { afterAll, afterEach, beforeEach, jest } from '@jest/globals';
import type { Href } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { MobileTemplateConfig } from '@/lib/templates';

export function createTemplateConfig(
  overrides: Partial<MobileTemplateConfig> = {}
): MobileTemplateConfig {
  return {
    headerStyle: 'standard',
    heroVariant: 'standard',
    categoryStyle: 'pill',
    cardVariant: 'grid',
    spacing: 'compact',
    borderRadius: 'md',
    ...overrides,
  };
}

export const mockUsePageConfig = jest.fn();
export const mockUseColorScheme = jest.fn(() => 'dark');
export const mockUseIsFocused = jest.fn(() => true);
export const mockRequestPermission = jest.fn(async () => 'granted');
export const mockRecordPerformanceSurface = jest.fn();
export const mockGetTemplateConfig = jest.fn(
  (_businessType?: string, _manualTemplateId?: string) => createTemplateConfig()
);
export const mockRouterPush = jest.fn<(href: Href) => void>();
export const mockResetQueries = jest.fn();
export const mockInvalidateQueries = jest.fn();
const MockText = Text;
const MockView = View;
const MockScrollView = ScrollView;
const idleGlobal = globalThis as unknown as {
  cancelIdleCallback?: (handle: number) => void;
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions
  ) => number;
};
const originalCancelIdleCallback = idleGlobal.cancelIdleCallback;
const originalRequestIdleCallback = idleGlobal.requestIdleCallback;
type MockBlock = { props?: { id?: string }; type: string };

type MockHomeFeedListProps = {
  blocks: MockBlock[];
  contentBottomPadding?: number;
  onScroll?: (event: unknown) => void;
  onRefresh?: () => void;
};

export const mockSearchDropdown = jest.fn(
  (_props: {
    isVisible?: boolean;
    onClose?: () => void;
    onQueryChange?: (text: string) => void;
    onSeeAllResults?: (query: string) => void;
    query?: string;
    showMinLengthHint?: boolean;
  }) => null
);

const mockHeader = jest.fn(
  ({
    isScrolled,
    onSearchPress,
    onSearchQueryChange,
    onSearchSubmit,
    searchQuery,
  }: {
    isScrolled?: boolean;
    onSearchPress?: () => void;
    onSearchQueryChange?: (text: string) => void;
    onSearchSubmit?: () => void;
    searchQuery?: string;
  }) => (
    <>
      <MockText testID="mock-header">Header {String(isScrolled)}</MockText>
      <Pressable testID="mock-header-search" onPress={onSearchPress}>
        <MockText>Search</MockText>
      </Pressable>
      <MockText testID="mock-header-query">{searchQuery ?? ''}</MockText>
      <Pressable
        testID="mock-header-query-type"
        onPress={() => onSearchQueryChange?.('iphone')}
      >
        <MockText>Type iphone</MockText>
      </Pressable>
      <Pressable
        testID="mock-header-query-type-short"
        onPress={() => onSearchQueryChange?.('i')}
      >
        <MockText>Type i</MockText>
      </Pressable>
      <Pressable testID="mock-header-submit" onPress={onSearchSubmit}>
        <MockText>Submit search</MockText>
      </Pressable>
    </>
  )
);

// HomeScreen now renders the virtualized feed through HomeFeedList; the feed
// internals are covered by HomeFeedList/use-home-product-feed tests, so here we
// stub it and surface the blocks + scroll handler for wiring assertions.
export const mockHomeFeedList = jest.fn((props: MockHomeFeedListProps) => (
  <MockScrollView testID="home-feed-list" onScroll={props.onScroll}>
    {props.blocks.map((block, index) => (
      <MockView
        key={block.props?.id ?? `${block.type}-${index}`}
        testID="block-renderer"
      >
        <MockText>{block.type}</MockText>
      </MockView>
    ))}
    <Pressable testID="home-feed-refresh" onPress={props.onRefresh}>
      <MockText>Refresh</MockText>
    </Pressable>
  </MockScrollView>
));

jest.mock('expo-image', () => ({
  Image: MockView,
}));

jest.mock('expo-router', () => ({
  router: {
    // Deferred through a closure: the factory can evaluate before the mock
    // binding is assigned, which would otherwise bake `push: undefined` in.
    push: (href: Href) => mockRouterPush(href),
  },
  useIsFocused: () => mockUseIsFocused(),
  useRouter: () => ({
    push: (href: Href) => mockRouterPush(href),
  }),
  Stack: {
    Screen: () => null,
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({
    top: 59,
    right: 0,
    bottom: 34,
    left: 0,
  }),
}));

jest.mock('@/components/OfflineNotice', () => ({
  OfflineNotice: () => <MockText>Offline notice</MockText>,
}));

jest.mock('@/components/home/HomeFeedList', () => ({
  HomeFeedList: (props: MockHomeFeedListProps) => mockHomeFeedList(props),
}));

jest.mock('@/components/storefront/Header', () => ({
  Header: (props: { isScrolled?: boolean }) => mockHeader(props),
}));

jest.mock('@/components/storefront/SearchDropdown', () => ({
  SearchDropdown: (props: Parameters<typeof mockSearchDropdown>[0]) => {
    mockSearchDropdown(props);
    return null;
  },
}));

jest.mock('@/components/ui/PermissionModal', () => ({
  PermissionModal: () => null,
}));

jest.mock('@/components/ui/Skeleton', () => ({
  HeroSkeleton: () => <MockText>Hero skeleton</MockText>,
  ProductGridSkeleton: () => <MockText>Grid skeleton</MockText>,
}));

jest.mock('@/components/ui/SnowEffect', () => ({
  SnowEffect: () => null,
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => mockUseColorScheme(),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    resetQueries: mockResetQueries,
    invalidateQueries: mockInvalidateQueries,
  }),
}));

jest.mock('@/hooks', () => ({
  __esModule: true,
  usePageConfig: (...args: [string?]) => mockUsePageConfig(...args),
}));

jest.mock('@/hooks/product-utils', () => ({
  CONSTANT_MERCHANT_ID: 'merchant-fallback',
}));

jest.mock('@/hooks/use-merchant', () => ({
  useMerchant: () => ({ data: { id: 'merchant-1' } }),
}));

jest.mock('@/hooks/use-network-state', () => ({
  useNetworkState: () => ({ isOnline: true }),
}));

jest.mock('@/hooks/use-permission-booster', () => ({
  usePermissionBooster: () => ({
    requestPermission: mockRequestPermission,
    triggerSystemPrompt: jest.fn(),
    markDenied: jest.fn(),
  }),
}));

jest.mock('@/lib/config', () => ({
  CONFIG: {
    BUSINESS_TYPE: 'gadgets',
    TEMPLATE_ID: 'default',
  },
}));

jest.mock('@/lib/performance-attribution', () => ({
  recordPerformanceSurface: (
    surface: string,
    details?: Record<string, unknown>
  ) => mockRecordPerformanceSurface(surface, details),
}));

jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: jest.fn(),
}));

jest.mock('@/lib/templates', () => ({
  __esModule: true,
  getTemplateConfig: (businessType?: string, manualTemplateId?: string) =>
    mockGetTemplateConfig(businessType, manualTemplateId),
}));

export function setupHomeScreenTestState() {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockHeader.mockClear();
    idleGlobal.requestIdleCallback = jest.fn(
      (callback: IdleRequestCallback) => {
        callback({
          didTimeout: false,
          timeRemaining: () => 50,
        });
        return 1;
      }
    );
    idleGlobal.cancelIdleCallback = jest.fn();
    mockUseColorScheme.mockReturnValue('dark');
    mockUseIsFocused.mockReturnValue(true);
    mockRequestPermission.mockResolvedValue('granted');
    mockGetTemplateConfig.mockReturnValue(createTemplateConfig());
    mockUsePageConfig.mockReturnValue({
      data: {
        content: [
          { type: 'HeroCarousel', props: { id: 'hero-1', slides: [] } },
          { type: 'CategoryRail', props: { id: 'categories-1' } },
          { type: 'ProductGrid', props: { id: 'products-1', limit: 12 } },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
  });

  afterEach(() => {
    mockRecordPerformanceSurface.mockReset();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  afterAll(() => {
    idleGlobal.requestIdleCallback = originalRequestIdleCallback;
    idleGlobal.cancelIdleCallback = originalCancelIdleCallback;
  });
}

export { default as HomeScreen } from '../../app/(tabs)/index';
