import * as Sentry from '@sentry/react-native';
import { useQueryClient } from '@tanstack/react-query';
import { router, useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import {
  runOnJS,
  useAnimatedScrollHandler,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HomeScreenView } from '@/components/home/HomeScreenView';
import { getHomeProductGridSummary } from '@/components/home/home-product-grid-summary';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { getHomeContentBottomPadding } from '@/constants/layout';
import { usePageConfig } from '@/hooks';
import { CONSTANT_MERCHANT_ID } from '@/hooks/product-utils';
import { useDeferredFocusRender } from '@/hooks/use-deferred-focus-render';
import { useMerchant } from '@/hooks/use-merchant';
import { useNetworkState } from '@/hooks/use-network-state';
import { CONFIG } from '@/lib/config';
import { recordCrashBreadcrumb } from '@/lib/crash-diagnostics';
import { recordPerformanceSurface } from '@/lib/performance-attribution';
import { resolveHomeBlocks } from '@/lib/resolve-home-blocks';
import { getTemplateConfig } from '@/lib/templates';

const HEADER_SOLID_BACKGROUND_OFFSET_PX = 10;
const HEADER_VISIBILITY_ANIMATION_DURATION_MS = 180;

const handleSearchSubmit = (): void => {
  Keyboard.dismiss();
};

export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const lastHomeStateBreadcrumbRef = useRef<string | null>(null);

  const template = getTemplateConfig(CONFIG.BUSINESS_TYPE, CONFIG.TEMPLATE_ID);
  const isChatWidgetEnabled = template.features?.chatWidget ?? true;

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    template.headerStyle === 'elite' ? 'u-airtime' : null
  );

  const queryClient = useQueryClient();
  const { data: merchant } = useMerchant();
  const merchantId = merchant?.id || CONSTANT_MERCHANT_ID;

  const shouldRenderDecorations = useDeferredFocusRender(isFocused);

  const {
    data: pageConfig,
    isLoading: isConfigLoading,
    refetch,
    isError,
  } = usePageConfig('home');

  const [refreshing, setRefreshing] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(150); // Initial estimate for spacer
  const [isScrolled, setIsScrolled] = useState(false);

  // Reanimated UI-thread values for continuous header folding calculations
  const headerVisibility = useSharedValue(1);
  const headerVisibilityTarget = useSharedValue(1);
  const previousOffsetY = useSharedValue(0);
  const isScrolledShared = useSharedValue(false);
  const searchVisibleShared = useSharedValue(false);

  // 2026 Best Practice: Network state monitoring for offline UX
  // Note: Manual onReconnect refetch removed — onlineManager.setOnline(true)
  // combined with refetchOnReconnect: true handles automatic refetching.
  const { isOnline } = useNetworkState();

  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const setHeaderVisibilityTarget = (target: 0 | 1) => {
    'worklet';
    if (headerVisibilityTarget.get() === target) return;

    headerVisibilityTarget.set(target);
    headerVisibility.set(
      withTiming(target, { duration: HEADER_VISIBILITY_ANIMATION_DURATION_MS })
    );
  };

  const handleSearch = () => {
    searchVisibleShared.set(true);
    setHeaderVisibilityTarget(1);
    setSearchVisible(true);
  };

  const handleSearchCancel = () => {
    searchVisibleShared.set(false);
    setSearchVisible(false);
    setSearchQuery('');
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      // Refresh both the page layout AND the product feed (page-1 reset) plus
      // category freshness. The partial key resets all active filter variants.
      await Promise.all([
        refetch(),
        queryClient.resetQueries({ queryKey: ['products', merchantId] }),
        queryClient.invalidateQueries({ queryKey: ['categories', merchantId] }),
      ]);
    } catch (error) {
      recordCrashBreadcrumb('home:refresh-failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setRefreshing(false);
    }
  };

  const handleHeaderLayout = ({
    nativeEvent,
  }: {
    nativeEvent: { layout: { height: number } };
  }) => {
    const nextHeight = nativeEvent.layout.height;
    if (nextHeight > 0 && Math.abs(nextHeight - headerHeight) > 1) {
      setHeaderHeight(nextHeight);
    }
  };

  const setIsScrolledJS = (nextScrolled: boolean) => {
    setIsScrolled(nextScrolled);
  };

  // C++ UI-thread header-fold handler (worklet). Infinite scroll now lives in
  // HomeFeedList's onEndReached, so this no longer computes load-more zones.
  const handleListScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      'worklet';
      if (searchVisibleShared.get()) return;

      const currentOffsetY = event.contentOffset.y;
      const normalizedOffsetY = Math.max(0, currentOffsetY);
      const prevOffsetY = previousOffsetY.get();
      previousOffsetY.set(currentOffsetY);

      // Toggle solid background header state dynamically
      const nextScrolled =
        normalizedOffsetY > HEADER_SOLID_BACKGROUND_OFFSET_PX;
      if (nextScrolled !== isScrolledShared.get()) {
        isScrolledShared.set(nextScrolled);
        runOnJS(setIsScrolledJS)(nextScrolled);
      }

      // Sliding header collapse transitions
      if (currentOffsetY <= 0) {
        setHeaderVisibilityTarget(1);
      } else if (currentOffsetY > prevOffsetY) {
        setHeaderVisibilityTarget(0);
      } else if (prevOffsetY - currentOffsetY > 15) {
        // scroll tolerance/hysteresis
        setHeaderVisibilityTarget(1);
      }
    },
  });

  const handleCategorySelect = (id: string | null) => {
    if (id?.startsWith('u-')) {
      setSelectedCategoryId(id);
      // 2026 Best Practice: Route to Guest Utility Flow
      const type = id.replace('u-', '');
      router.push(`/utilities/${type}` as never);
      return;
    }
    setSelectedCategoryId(id);
  };

  const blocks = resolveHomeBlocks(
    pageConfig?.content,
    template.headerStyle === 'elite',
    isConfigLoading && !pageConfig
  );
  const { primaryProductGridIndex, productGridBlockCount } =
    getHomeProductGridSummary(blocks);
  const hasPageConfig = Boolean(pageConfig);

  useEffect(() => {
    recordCrashBreadcrumb('home:mounted', {
      businessType: CONFIG.BUSINESS_TYPE,
      templateId: CONFIG.TEMPLATE_ID,
    });
    return () => recordCrashBreadcrumb('home:unmounted');
  }, []);

  useEffect(() => {
    Sentry.addBreadcrumb({
      category: 'performance.surface',
      data: { focused: isFocused, surface: 'home' },
      level: 'info',
      message: `home:${isFocused ? 'focused' : 'unfocused'}`,
    });
    recordCrashBreadcrumb('home:state', { focused: isFocused });
    if (isFocused) {
      recordPerformanceSurface('home', { template_id: CONFIG.TEMPLATE_ID });
    }
  }, [isFocused]);

  useEffect(() => {
    const stateSignature = JSON.stringify({
      blockCount: blocks.length,
      hasPageConfig,
      isError,
      isFocused,
      primaryProductGridIndex,
      productGridBlockCount,
      selectedCategoryId,
    });

    if (lastHomeStateBreadcrumbRef.current === stateSignature) {
      return;
    }

    lastHomeStateBreadcrumbRef.current = stateSignature;
    recordCrashBreadcrumb('home:state', {
      blockCount: blocks.length,
      hasPageConfig,
      isError,
      isFocused,
      primaryProductGridIndex,
      productGridBlockCount,
      selectedCategoryId,
    });
  }, [
    blocks.length,
    hasPageConfig,
    isError,
    isFocused,
    primaryProductGridIndex,
    productGridBlockCount,
    selectedCategoryId,
  ]);

  const resolvedHeaderHeight = headerHeight > 0 ? headerHeight : 150;
  const isElite = template.headerStyle === 'elite';
  const homeContentBottomPadding = getHomeContentBottomPadding(
    insets.bottom,
    isChatWidgetEnabled
  );

  return (
    <HomeScreenView
      backgroundColor={colors.background}
      blackColor={colors.black}
      blocks={blocks}
      contentBottomPadding={homeContentBottomPadding}
      hasPageConfig={hasPageConfig}
      headerVisibility={headerVisibility}
      isConfigLoading={isConfigLoading && !refreshing}
      isElite={isElite}
      isError={isError}
      isOnline={isOnline}
      isScrolled={isScrolled}
      onCategorySelect={handleCategorySelect}
      onHeaderLayout={handleHeaderLayout}
      onListScroll={handleListScroll}
      onRefresh={handleRefresh}
      onSearch={handleSearch}
      onSearchCancel={handleSearchCancel}
      onSearchQueryChange={setSearchQuery}
      onSearchSubmit={handleSearchSubmit}
      primaryColor={colors.primary}
      primaryProductGridIndex={primaryProductGridIndex}
      refreshing={refreshing}
      resolvedHeaderHeight={resolvedHeaderHeight}
      searchQuery={searchQuery}
      searchVisible={searchVisible}
      selectedCategoryId={selectedCategoryId}
      shouldRenderDecorations={shouldRenderDecorations}
    />
  );
}
