import {
  FlashList,
  type FlashListProps,
  type FlashListRef,
} from '@shopify/flash-list';
import {
  type ComponentProps,
  type ComponentType,
  useEffect,
  useRef,
} from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  type StyleProp,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, { type ScrollHandlerProcessed } from 'react-native-reanimated';
import { AdSlot } from '@/components/ads/AdSlot';
import { BlockRenderer } from '@/components/storefront/BlockRenderer';
import { FilterBar } from '@/components/storefront/FilterBar';
import { HomeServiceCards } from '@/components/storefront/HomeServiceCards';
import { findHeroAdOwnerBlockId } from '@/components/storefront/hero-ad-owner';
import { findLaunchAdOwnerBlockId } from '@/components/storefront/launch-ad-owner';
import { styles as gridStyles } from '@/components/storefront/ProductGrid.styles';
import { ProductGridSkeleton } from '@/components/ui/Skeleton';
import { palette } from '@/constants/Colors';
import { PRODUCT_GRID_LOADING_MORE_LABEL } from '@/constants/product-grid';
import { useTheme } from '@/hooks/useTheme';
import { CONFIG } from '@/lib/config';
import { getTemplateConfig } from '@/lib/templates';
import type { Block, ProductGridBlock } from '@/types/blocks';
import type { Product } from '@/types/product';
import { HomeFeedEmptyState } from './HomeFeedEmptyState';
import { HomeFeedListItemView } from './HomeFeedListItemView';
import { useHomeProductFeed } from './use-home-product-feed';

export type HomeFeedListItem =
  | { kind: 'product'; product: Product }
  | { kind: 'product-list-end'; id: string };

const AnimatedFlashList = Animated.createAnimatedComponent(
  FlashList as ComponentType<FlashListProps<HomeFeedListItem>>
);

interface HomeFeedListProps {
  blocks: Block[];
  primaryProductGridIndex: number;
  selectedCategoryId: string | null;
  onCategorySelect: (id: string | null) => void;
  onScroll: ScrollHandlerProcessed<Record<string, unknown>>;
  isSearchOpen: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  primaryColor: string;
  resolvedHeaderHeight: number;
  contentBottomPadding: number;
  blockWrapperStyle?: StyleProp<ViewStyle>;
}

export function HomeFeedList({
  blocks,
  primaryProductGridIndex,
  selectedCategoryId,
  onCategorySelect,
  onScroll,
  isSearchOpen,
  refreshing,
  onRefresh,
  primaryColor,
  resolvedHeaderHeight,
  contentBottomPadding,
  blockWrapperStyle,
}: HomeFeedListProps) {
  const { colors } = useTheme();
  const hasPrimaryGrid = primaryProductGridIndex >= 0;
  const template = getTemplateConfig(CONFIG.BUSINESS_TYPE, CONFIG.TEMPLATE_ID);
  const primaryBlock = hasPrimaryGrid
    ? (blocks[primaryProductGridIndex] as ProductGridBlock)
    : undefined;
  const limit = primaryBlock?.props.limit ?? 12;
  const blockTitle = primaryBlock?.props.title;

  const {
    feedProducts,
    isLoading,
    isFetching,
    isLoadingMore,
    isRetrying,
    hasMore,
    currentVariant,
    filterBarProps,
    handleRetry,
    loadMore,
    shouldShowFatalError,
    shouldShowInitialLoading,
    feedResetKey,
  } = useHomeProductFeed({
    enabled: hasPrimaryGrid,
    selectedCategoryId,
    variant: template.cardVariant,
    limit,
  });

  const listRef = useRef<FlashListRef<HomeFeedListItem>>(null);

  useEffect(() => {
    void feedResetKey;
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [feedResetKey]);

  const numColumns = currentVariant === 'grid' ? 2 : 1;
  const headerBlocks = hasPrimaryGrid
    ? blocks.slice(0, primaryProductGridIndex)
    : blocks;
  const footerBlocks = hasPrimaryGrid
    ? blocks.slice(primaryProductGridIndex + 1)
    : [];
  // HOME_STRIP is one logical slot for the whole page, but each slice
  // renders its own BlockRenderer: elect the owner across both slices so a
  // header hero and a footer hero cannot each claim it.
  const heroAdOwnerBlockId = findHeroAdOwnerBlockId([
    ...headerBlocks,
    ...footerBlocks,
  ]);
  // PRODUCT_GRID_MPU is likewise one logical slot for the whole page: elect
  // the owner across both slices so repeated JustLaunched blocks cannot each
  // claim it.
  const launchAdOwnerBlockId = findLaunchAdOwnerBlockId([
    ...headerBlocks,
    ...footerBlocks,
  ]);
  const renderAfterCategoryRail = (block: Block) =>
    block.type === 'CategoryRail' ? (
      <HomeServiceCards placement="belowUtility" />
    ) : null;

  const handleProductDataEndReached = () => {
    // The sentinel sits immediately after the product data, before post-grid
    // blocks, so pagination starts before the user scrolls through the footer.
    if (!hasPrimaryGrid || isSearchOpen || !hasMore || isLoadingMore) return;
    loadMore();
  };

  const renderItem = ({
    item,
    index,
    target,
  }: {
    item: HomeFeedListItem;
    index: number;
    target?: string;
  }) => (
    <HomeFeedListItemView
      item={item}
      index={index}
      target={target}
      currentVariant={currentVariant}
      onProductDataEndReached={handleProductDataEndReached}
    />
  );

  const handleEndReached = () => {
    // Backup trigger for layouts without post-grid blocks; the sentinel handles
    // the common case before footer content extends the measured list end.
    handleProductDataEndReached();
  };

  const visibleFeedProducts = hasPrimaryGrid ? feedProducts : [];
  const feedItems: HomeFeedListItem[] = visibleFeedProducts.map((product) => ({
    kind: 'product',
    product,
  }));
  if (visibleFeedProducts.length > 0 && hasMore) {
    feedItems.push({
      kind: 'product-list-end',
      id: `home-feed-product-list-end-${feedResetKey}`,
    });
  }

  const listHeader = (
    <View>
      <View
        testID="home-feed-header-spacer"
        style={{ height: resolvedHeaderHeight }}
      />
      <BlockRenderer
        blocks={headerBlocks}
        selectedCategoryId={selectedCategoryId}
        onCategorySelect={onCategorySelect}
        blockWrapperStyle={blockWrapperStyle}
        renderAfterBlock={renderAfterCategoryRail}
        // Search covers the feed with a full-screen scrim; withhold the
        // home ad placements so no obscured delivery is requested.
        suppressAds={isSearchOpen}
        heroAdOwnerBlockId={heroAdOwnerBlockId}
        launchAdOwnerBlockId={launchAdOwnerBlockId}
      />
      {hasPrimaryGrid ? (
        <>
          {blockTitle ? (
            <Text style={[gridStyles.sectionTitle, { color: colors.text }]}>
              {blockTitle}
            </Text>
          ) : null}
          <FilterBar {...filterBarProps} />
        </>
      ) : null}
    </View>
  );

  const listFooter = (
    <View>
      {isLoadingMore ? (
        <View
          style={gridStyles.loadingMore}
          accessible
          accessibilityLabel={PRODUCT_GRID_LOADING_MORE_LABEL}
          accessibilityRole="progressbar"
          testID="home-feed-loading-more"
        >
          <ActivityIndicator
            size="small"
            color={palette.gray[400]}
            accessibilityElementsHidden
          />
        </View>
      ) : null}
      <BlockRenderer
        blocks={footerBlocks}
        selectedCategoryId={selectedCategoryId}
        onCategorySelect={onCategorySelect}
        blockWrapperStyle={blockWrapperStyle}
        renderAfterBlock={renderAfterCategoryRail}
        suppressAds={isSearchOpen}
        heroAdOwnerBlockId={heroAdOwnerBlockId}
        launchAdOwnerBlockId={launchAdOwnerBlockId}
      />
      {/* The footer renders alongside the empty state: while the feed is
          initially loading or fatally errored the slot would request below
          a skeleton or retry error with no resolved product feed. */}
      {isSearchOpen ||
      shouldShowInitialLoading ||
      shouldShowFatalError ? null : (
        <AdSlot placement="PRODUCT_GRID_IN_FEED" />
      )}
    </View>
  );

  const listEmpty = hasPrimaryGrid ? (
    <HomeFeedEmptyState
      shouldShowFatalError={shouldShowFatalError}
      shouldShowInitialLoading={shouldShowInitialLoading}
      isLoading={isLoading}
      isFetching={isFetching}
      isRetrying={isRetrying}
      onRetry={handleRetry}
      skeleton={<ProductGridSkeleton count={4} />}
    />
  ) : null;

  return (
    <AnimatedFlashList
      ref={
        listRef as unknown as ComponentProps<typeof AnimatedFlashList>['ref']
      }
      key={`home-feed-${currentVariant}-${numColumns}`}
      testID="home-feed-list"
      data={feedItems}
      numColumns={numColumns}
      renderItem={renderItem}
      keyExtractor={(item) =>
        item.kind === 'product' ? item.product.id : item.id
      }
      getItemType={(item) => item.kind}
      overrideItemLayout={(layout, item) => {
        if (item.kind === 'product-list-end') {
          layout.span = numColumns;
        }
      }}
      onScroll={onScroll}
      scrollEventThrottle={16}
      onEndReached={handleEndReached}
      onEndReachedThreshold={0.5}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={primaryColor}
          colors={[primaryColor]}
          progressViewOffset={resolvedHeaderHeight}
        />
      }
      ListHeaderComponent={listHeader}
      ListFooterComponent={listFooter}
      ListEmptyComponent={listEmpty}
      contentContainerStyle={{
        paddingBottom: contentBottomPadding,
      }}
      showsVerticalScrollIndicator={false}
    />
  );
}
