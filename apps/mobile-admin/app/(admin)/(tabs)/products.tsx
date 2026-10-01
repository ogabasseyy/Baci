import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import PagerView from 'react-native-pager-view';
import ReAnimated, {
  runOnJS,
  useEvent,
  useSharedValue,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CreateCategoryModal } from '@/components/product/CreateCategoryModal';
import { ProductsSearchActions } from '@/components/product/ProductsSearchActions';
import type { ProductsTab } from '@/components/product/ProductsSubTabs';
import { ProductsTabPage } from '@/components/product/ProductsTabPage';
import { getCurrencySymbol } from '@/components/product/product.shared';
import { TopTabBar } from '@/components/ui/TopTabBar';
import { SPACING, TYPOGRAPHY } from '@/constants/theme';
import { useAdminTabScrollToTop } from '@/hooks/useAdminTabScrollToTop';
import { useCollapsibleSearchBar } from '@/hooks/useCollapsibleSearchBar';
import { useDebounce } from '@/hooks/useDebounce';
import { useMerchant } from '@/hooks/useMerchant';
import { useCreateCategory, useInventoryStats } from '@/hooks/useProducts';
import { useTheme } from '@/hooks/useTheme';

const AnimatedPagerView = ReAnimated.createAnimatedComponent(PagerView);

type TopTab = 'in_stock' | 'on_website';

const TOP_TAB_INDEXES: Record<TopTab, number> = {
  in_stock: 0,
  on_website: 1,
};
const INDEX_TO_TOP_TAB: TopTab[] = ['in_stock', 'on_website'];

export default function ProductsScreen() {
  const { colors, shadows, isDark } = useTheme();
  const { merchant } = useMerchant();
  const currencySymbol = getCurrencySymbol(merchant?.payout_currency);

  const [topTab, setTopTab] = useState<TopTab>('in_stock');
  const inStockScrollRef = useRef<{
    scrollToOffset: (options: { offset: number; animated?: boolean }) => void;
  }>(null);
  const websiteScrollRef = useRef<{
    scrollToOffset: (options: { offset: number; animated?: boolean }) => void;
  }>(null);
  useAdminTabScrollToTop(
    'products',
    topTab === 'in_stock' ? inStockScrollRef : websiteScrollRef
  );
  // The website page mounts lazily — as soon as a swipe toward it starts.
  const [isWebsiteVisited, setIsWebsiteVisited] = useState(false);
  // Each page owns its sub-tab; the screen only mirrors them for the FAB.
  const [subTabByPage, setSubTabByPage] = useState<Record<TopTab, ProductsTab>>(
    { in_stock: 'in_stock', on_website: 'all' }
  );

  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 250);

  const { data: inventoryStats } = useInventoryStats();
  const createCategoryMutation = useCreateCategory();

  // Category Creation State
  const [isCategoryModalVisible, setIsCategoryModalVisible] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  const handleCreateCategory = () => {
    const trimmedCategoryName = newCategoryName.trim();
    if (!trimmedCategoryName || createCategoryMutation.isPending) return;

    createCategoryMutation.mutate(trimmedCategoryName, {
      onSuccess: () => {
        setNewCategoryName('');
        setIsCategoryModalVisible(false);
      },
      onError: (err) => {
        Alert.alert('Error', err.message);
      },
    });
  };

  // Native pager wiring — the indicator tracks the drag via a shared value
  // updated on the UI thread (same pattern as the storefront utility pager).
  const pagerRef = useRef<PagerView>(null);
  const pagerPosition = useSharedValue(0);
  const websiteVisitedFlag = useSharedValue(0);

  const markWebsiteVisited = () => setIsWebsiteVisited(true);

  const pageScrollHandler = useEvent(
    (event: { position: number; offset: number }) => {
      'worklet';
      const progress = event.position + event.offset;
      pagerPosition.value = progress;
      if (websiteVisitedFlag.value === 0 && progress > 0.02) {
        // Mount the website page the moment a swipe toward it begins, so the
        // incoming page shows real content mid-drag.
        websiteVisitedFlag.value = 1;
        runOnJS(markWebsiteVisited)();
      }
    },
    ['onPageScroll']
  );

  const handlePageSelected = (event: { nativeEvent: { position: number } }) => {
    const nextTab = INDEX_TO_TOP_TAB[event.nativeEvent.position];
    if (nextTab && nextTab !== topTab) {
      setTopTab(nextTab);
    }
    if (nextTab === 'on_website') {
      setIsWebsiteVisited(true);
    }
  };

  const handleTopTabChange = (tab: TopTab) => {
    if (tab === 'on_website') {
      setIsWebsiteVisited(true);
    }
    setTopTab(tab);
    pagerRef.current?.setPage(TOP_TAB_INDEXES[tab]);
  };

  const { handleScroll, isSearchActionsVisible, searchBarAnim } =
    useCollapsibleSearchBar();

  const activeSubTab = subTabByPage[topTab];

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Products</Text>
      </View>

      <TopTabBar
        activeTab={topTab}
        inStockCount={inventoryStats?.activeCount ?? 0}
        onWebsiteCount={inventoryStats?.totalProducts ?? 0}
        onTabChange={handleTopTabChange}
        pagerPosition={pagerPosition}
      />

      <ProductsSearchActions
        colors={colors}
        isVisible={isSearchActionsVisible}
        onClearSearch={() => setSearchQuery('')}
        onScanPress={() => router.push('/scan')}
        onSearchChange={setSearchQuery}
        searchBarAnim={searchBarAnim}
        searchQuery={searchQuery}
      />

      <AnimatedPagerView
        ref={pagerRef}
        initialPage={0}
        // useEvent's worklet handler type doesn't line up with the pager's
        // direct-event prop; same cast idiom as the storefront utility pager.
        onPageScroll={pageScrollHandler as unknown as (event: unknown) => void}
        onPageSelected={handlePageSelected}
        style={styles.pager}
        testID="products-pager"
      >
        <View key="in_stock" collapsable={false} style={styles.page}>
          <ProductsTabPage
            scrollRef={inStockScrollRef}
            currencySymbol={currencySymbol}
            onClearSearch={() => setSearchQuery('')}
            onOpenCreateCategory={() => setIsCategoryModalVisible(true)}
            onScroll={handleScroll}
            onSubTabChange={(subTab) =>
              setSubTabByPage((previous) => ({
                ...previous,
                in_stock: subTab,
              }))
            }
            searchQuery={debouncedSearchQuery}
            variant="in_stock"
          />
        </View>
        <View key="on_website" collapsable={false} style={styles.page}>
          {isWebsiteVisited ? (
            <ProductsTabPage
              scrollRef={websiteScrollRef}
              currencySymbol={currencySymbol}
              onClearSearch={() => setSearchQuery('')}
              onOpenCreateCategory={() => setIsCategoryModalVisible(true)}
              onScroll={handleScroll}
              onSubTabChange={(subTab) =>
                setSubTabByPage((previous) => ({
                  ...previous,
                  on_website: subTab,
                }))
              }
              searchQuery={debouncedSearchQuery}
              variant="on_website"
            />
          ) : null}
        </View>
      </AnimatedPagerView>

      <Pressable
        style={({ pressed }) => [
          styles.fab,
          { backgroundColor: colors.gold },
          shadows.lg,
          pressed && { transform: [{ scale: 0.95 }] },
        ]}
        onPress={() => {
          if (activeSubTab === 'categories') {
            setIsCategoryModalVisible(true);
          } else {
            router.push('/product/new');
          }
        }}
        accessibilityLabel={
          activeSubTab === 'categories' ? 'Add new category' : 'Add new product'
        }
        accessibilityRole="button"
        accessibilityHint={
          activeSubTab === 'categories'
            ? 'Opens form to create a new category'
            : 'Opens form to create a new product'
        }
      >
        <Ionicons name="add" size={28} color={colors.textOnPrimary} />
      </Pressable>

      <CreateCategoryModal
        isSubmitting={createCategoryMutation.isPending}
        name={newCategoryName}
        onChangeName={setNewCategoryName}
        onClose={() => setIsCategoryModalVisible(false)}
        onSubmit={handleCreateCategory}
        visible={isCategoryModalVisible}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  fab: {
    alignItems: 'center',
    borderRadius: 28,
    bottom: 125,
    height: 56,
    justifyContent: 'center',
    position: 'absolute',
    right: SPACING.lg,
    width: 56,
    zIndex: 300,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  page: {
    flex: 1,
  },
  pager: {
    flex: 1,
  },
  title: {
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    fontSize: TYPOGRAPHY.size['3xl'],
  },
});
