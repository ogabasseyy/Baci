import { useQueryClient } from '@tanstack/react-query';
import { type Href, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import type PagerView from 'react-native-pager-view';
import { useEvent, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import AppKeyboardContainer from '@/components/ui/AppKeyboardContainer';
import { useColorScheme } from '@/components/useColorScheme';
import { InvalidUtilityServiceView } from '@/components/utilities/InvalidUtilityServiceView';
import { UtilityHeader } from '@/components/utilities/UtilityHeader';
import { UtilityPurchasePager } from '@/components/utilities/UtilityPurchasePager';
import { UtilityPurchaseSuccessView } from '@/components/utilities/UtilityPurchaseSuccessView';
import { UtilityTypeTabs } from '@/components/utilities/UtilityTypeTabs';
import { useQuickRepeat } from '@/components/utilities/use-quick-repeat';
import {
  getUtilityHistoryIconColor,
  isValidUtilityType,
  UTILITY_TYPE_TITLES,
} from '@/components/utilities/utility-purchase.config';
import {
  getParamSuccessData,
  toUtilityRouteParams,
  type UtilityRouteParamKey,
} from '@/components/utilities/utility-purchase.route-params';
import { utilityPurchaseStyles as styles } from '@/components/utilities/utility-purchase.styles';
import type {
  UtilityPurchaseResult,
  ValidUtilityType,
} from '@/components/utilities/utility-purchase.types';
import Colors from '@/constants/Colors';
import { walletKeys } from '@/hooks/use-wallet';
import { CONFIG } from '@/lib/config';
import { RouteRepeatParamsSchema } from '@/schemas/utility-purchase';
import { useAuthStore } from '@/stores/auth-store';

const UTILITY_TYPE_INDEXES: Record<ValidUtilityType, number> = {
  airtime: 0,
  data: 1,
  tv: 2,
  power: 3,
  gaming: 4,
};

const INDEX_TO_UTILITY_TYPE: readonly ValidUtilityType[] = [
  'airtime',
  'data',
  'tv',
  'power',
  'gaming',
];

export default function UtilityPurchaseScreen() {
  const rawParams =
    useLocalSearchParams<
      Partial<Record<UtilityRouteParamKey, string | string[]>>
    >();
  const params = toUtilityRouteParams(rawParams);
  const repeatParamsResult = RouteRepeatParamsSchema.safeParse(params);
  const repeatParams = repeatParamsResult.success
    ? repeatParamsResult.data
    : {};
  const queryClient = useQueryClient();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const headerOffset = Math.max(insets.top, 42);
  const isAuthenticated = useAuthStore((state) => !!state.session);
  // Mirror useWallet's owner fallback (customer.id ?? user.id) so the
  // post-purchase invalidation hits the same query key the wallet read
  // uses while customer hydration is still pending.
  const walletOwnerId = useAuthStore(
    (state) => state.customer?.id ?? state.user?.id
  );
  const merchantId = useAuthStore((state) => state.merchantId);
  const activeMerchantId = merchantId || CONFIG.MERCHANT_ID;
  const routeType =
    params.type && isValidUtilityType(params.type) ? params.type : null;
  const [successData, setSuccessData] = useState<UtilityPurchaseResult | null>(
    null
  );
  const [selectedType, setSelectedType] = useState<ValidUtilityType | null>(
    routeType
  );
  const [prevRouteType, setPrevRouteType] = useState(routeType);
  if (routeType !== prevRouteType) {
    // Adjust state inline during render with a prev-prop comparison instead
    // of an effect, so users never see a stale-type frame between commits.
    setPrevRouteType(routeType);
    if (routeType) {
      setSelectedType(routeType);
    }
  }
  const [visitedTypes, setVisitedTypes] = useState<
    Record<ValidUtilityType, boolean>
  >(() => ({
    airtime: routeType === 'airtime',
    data: routeType === 'data',
    tv: routeType === 'tv',
    power: routeType === 'power',
    gaming: routeType === 'gaming',
  }));
  const currentType = selectedType ?? routeType;
  if (currentType && !visitedTypes[currentType]) {
    // Guarded render-time adjustment (converges in one extra render pass);
    // an effect here would commit a frame before the visited tab mounts.
    setVisitedTypes((prev) =>
      prev[currentType] ? prev : { ...prev, [currentType]: true }
    );
  }
  const historyFilter = currentType ?? 'airtime';
  const title = currentType ? UTILITY_TYPE_TITLES[currentType] : 'Utility';
  const quickRepeat = useQuickRepeat({
    currentType,
    historyFilter,
    ...repeatParams,
    routeType,
  });
  const resolvedSuccessData = successData ?? getParamSuccessData(params);
  const successReference = resolvedSuccessData?.reference;

  const pagerRef = useRef<PagerView>(null);

  const activeIndex = useSharedValue(
    routeType ? UTILITY_TYPE_INDEXES[routeType] : 0
  );

  const pageScrollHandler = useEvent(
    (event: { position: number; offset: number }) => {
      'worklet';
      activeIndex.set(event.position + event.offset);
    },
    ['onPageScroll']
  );

  const handlePageSelected = (event: { nativeEvent: { position: number } }) => {
    const newIndex = event.nativeEvent.position;
    const newType = INDEX_TO_UTILITY_TYPE[newIndex];
    if (newType && newType !== selectedType) {
      setSelectedType(newType);
    }
  };

  // State syncing happens during render above; this effect only keeps the
  // imperative pager position in step with the route param.
  useEffect(() => {
    if (routeType) {
      pagerRef.current?.setPage(UTILITY_TYPE_INDEXES[routeType]);
    }
  }, [routeType]);

  useEffect(() => {
    // Every wallet purchase debits the wallet, with or without cashback,
    // so invalidate on any success/processing reference — otherwise the
    // pre-debit balance stays cached as fresh and the next purchase can
    // submit against a stale balance the server will reject.
    if (!currentType || !walletOwnerId || !successReference) {
      return;
    }

    void queryClient.invalidateQueries({
      queryKey: walletKeys.data({
        merchantId: activeMerchantId,
        ownerId: walletOwnerId,
      }),
    });
  }, [
    activeMerchantId,
    currentType,
    walletOwnerId,
    queryClient,
    successReference,
  ]);

  const handleGoBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/' as Href);
  };

  const handleUtilityTypeChange = (nextType: ValidUtilityType) => {
    if (nextType !== currentType) {
      setSelectedType(nextType);
      const nextIndex = UTILITY_TYPE_INDEXES[nextType];
      pagerRef.current?.setPage(nextIndex);
    }
  };

  if (!routeType || !currentType) {
    return (
      <StorefrontScreenShell
        edges={[]}
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <InvalidUtilityServiceView
          colors={colors}
          onBack={handleGoBack}
          topInset={insets.top}
        />
      </StorefrontScreenShell>
    );
  }

  if (resolvedSuccessData) {
    return (
      <StorefrontScreenShell
        edges={[]}
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <UtilityPurchaseSuccessView
          bottomPadding={Math.max(insets.bottom - 12, 0)}
          colors={colors}
          data={resolvedSuccessData}
          headerOffset={headerOffset}
          isAuthenticated={isAuthenticated}
          onCreateAccount={() => router.push('/auth/login')}
          type={currentType}
        />
      </StorefrontScreenShell>
    );
  }

  return (
    <StorefrontScreenShell
      edges={[]}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <UtilityHeader
        title={title}
        onBack={handleGoBack}
        onHistory={() =>
          router.push(`/utilities/history?type=${currentType}` as Href)
        }
        titleColor={colors.text}
        dividerColor={colors.border}
        iconBackgroundColor={colors.card}
        iconColor={colors.text}
        historyIconColor={getUtilityHistoryIconColor(colorScheme)}
        topInset={insets.top}
        surfaceColor={colors.background}
      />
      <AppKeyboardContainer style={styles.container}>
        <UtilityTypeTabs
          selectedType={currentType}
          onSelect={handleUtilityTypeChange}
        />
        <UtilityPurchasePager
          currentType={currentType}
          initialPage={UTILITY_TYPE_INDEXES[currentType]}
          onPageScroll={
            pageScrollHandler as unknown as (event: unknown) => void
          }
          onPageSelected={handlePageSelected}
          onSuccess={setSuccessData}
          pagerRef={pagerRef}
          quickRepeat={quickRepeat}
          visitedTypes={visitedTypes}
        />
      </AppKeyboardContainer>
    </StorefrontScreenShell>
  );
}
