import { withKudaElectricityBillItems } from '@baci/shared/lib';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { EXPO_PUBLIC_API_URL } from '@/env';
import { fetchWithRetry } from '@/lib/api';
import { isRestrictedSavingsSandbox } from '@/lib/is-restricted-savings-sandbox';
import { logger } from '@/lib/logger';
import { BILLER_GC_TIME, BILLER_STALE_TIME } from '@/lib/vtu-constants';
import {
  type Biller,
  BillerListSchema,
  type BillItem,
} from '@/lib/vtu-schemas';

export type { Biller, BillItem };
export const ALL_BILL_TYPES = [
  'data',
  'cable_tv',
  'electricity',
  'betting',
] as const;
export type BillType = (typeof ALL_BILL_TYPES)[number];

const log = logger;

export const vtuBillerKeys = {
  all: ['vtu', 'billers'] as const,
  byType: (type: BillType) => ['vtu', 'billers', type] as const,
};

/** All bill types that can be prefetched */
const PREFETCH_TYPES = ALL_BILL_TYPES;
const BILLER_PREFETCH_START_DELAY_MS = 700;
const BILLER_PREFETCH_STAGGER_MS = 250;

function withBillItemsForType(type: BillType, billers: Biller[]): Biller[] {
  return type === 'electricity'
    ? withKudaElectricityBillItems(billers)
    : billers;
}

function getErrorMessages(error: unknown): string[] {
  if (!(error instanceof Error)) {
    return [String(error)];
  }

  const messages = [error.message];
  const nestedError = (error as { lastError?: unknown }).lastError;
  if (nestedError instanceof Error) {
    messages.push(nestedError.message);
  }

  return messages;
}

function isCanceledFetchError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') {
    return true;
  }

  return getErrorMessages(error).some((message) => {
    const normalizedMessage = message.toLowerCase();
    return (
      normalizedMessage.includes('fetch request has been canceled') ||
      normalizedMessage.includes('fetch request has been cancelled') ||
      normalizedMessage.includes('request has been canceled') ||
      normalizedMessage.includes('request has been cancelled')
    );
  });
}

function scheduleDeferredBillerPrefetch(callback: () => void, index: number) {
  const frameIds: number[] = [];
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  const run = () => {
    if (cancelled) {
      return;
    }

    timeoutId = setTimeout(
      callback,
      BILLER_PREFETCH_START_DELAY_MS + index * BILLER_PREFETCH_STAGGER_MS
    );
  };

  if (typeof globalThis.requestAnimationFrame !== 'function') {
    run();
    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }

  const firstFrame = globalThis.requestAnimationFrame(() => {
    const secondFrame = globalThis.requestAnimationFrame(run);
    frameIds.push(secondFrame);
  });
  frameIds.push(firstFrame);

  return () => {
    cancelled = true;
    frameIds.forEach((frameId) => {
      globalThis.cancelAnimationFrame?.(frameId);
    });
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  };
}

/** Shared fetch function used by both useQuery and prefetch */
async function fetchBillers(type: BillType): Promise<Biller[]> {
  if (isRestrictedSavingsSandbox()) {
    throw new Error(
      'Utility purchases are not available in this savings sandbox.'
    );
  }
  const startTime = Date.now();
  log.info('VTU', `Fetching billers for type: ${type}`);
  const includeMonnify =
    type === 'electricity' || type === 'cable_tv' ? '&includeMonnify=true' : '';

  try {
    const response = await fetchWithRetry(
      `${EXPO_PUBLIC_API_URL}/api/vtu/billers?type=${type}${includeMonnify}`,
      {
        cache: 'no-store',
      },
      {
        timeout: 10000,
        maxRetries: 2,
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch providers (HTTP ${response.status})`);
    }

    const data = await response.json();

    const duration = Date.now() - startTime;
    log.info('VTU', `Biller fetch completed in ${duration}ms`);

    if (data.error) {
      throw new Error(data.error);
    }

    const result = BillerListSchema.safeParse(data);
    if (!result.success) {
      log.warn(
        'VTU',
        'Biller API response failed Zod validation',
        result.error.format()
      );
      throw new Error('Invalid provider data received. Please try again.');
    }

    return result.data.billers;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    if (isCanceledFetchError(error)) {
      log.info('VTU', `Biller fetch canceled: ${errorMessage}`);
    } else {
      log.error('VTU', `Failed to fetch billers: ${errorMessage}`);
    }
    throw error;
  }
}

/**
 * Fetches available billers for a given bill type.
 * Uses a short stale window because provider packages and nested bill items
 * can change independently of the app release cycle.
 */
export function useVTUBillers(type: BillType, enabled = true) {
  return useQuery<Biller[]>({
    queryKey: vtuBillerKeys.byType(type),
    queryFn: () => fetchBillers(type),
    select: (billers) => withBillItemsForType(type, billers),
    staleTime: BILLER_STALE_TIME,
    gcTime: BILLER_GC_TIME,
    enabled,
    ...(isRestrictedSavingsSandbox() ? { retry: false } : {}),
  });
}

/**
 * Prefetches billers for all bill categories on mount.
 * Call this from UtilityPanel so data is cached before the user taps a category.
 */
export function usePrefetchBillers() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (isRestrictedSavingsSandbox()) return;
    const cancelPrefetchTasks = PREFETCH_TYPES.map((type, index) =>
      scheduleDeferredBillerPrefetch(() => {
        queryClient.prefetchQuery({
          queryKey: vtuBillerKeys.byType(type),
          queryFn: () => fetchBillers(type),
          staleTime: BILLER_STALE_TIME,
          gcTime: BILLER_GC_TIME,
        });
      }, index)
    );

    return () => {
      cancelPrefetchTasks.forEach((cancelPrefetchTask) => {
        cancelPrefetchTask();
      });
    };
  }, [queryClient]);
}
