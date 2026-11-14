import type {
  ExperienceErrorCode,
  SharedCartCommandPort,
} from '@baci/shared/experience';
import type { AttemptAdmission } from '@/lib/api-attempt-policy';
import { cartRoute, fetchSharedCartProducts } from './shared-cart-client';
import { publicCartSnapshot } from './shared-cart-command-mapping';
import type { ReceiptStorage } from './shared-cart-operation-receipts';
import { ensureCartDeviceRevocationCleared } from './shared-cart-session-revoke-client';
import type { SharedCartRuntime } from './use-shared-cart-runtime';
export interface ExperienceCartHostPort extends SharedCartCommandPort {
  withAdmission(
    admit: () => AttemptAdmission<ExperienceErrorCode>,
    rebind?: (partition: string) => boolean,
    sameShopper?: () => boolean,
    refreshAdmission?: () => Promise<boolean>
  ): SharedCartCommandPort;
  readPublic(
    currency: string
  ): Promise<
    import('@baci/shared/experience').BridgeResult<
      import('@baci/shared/experience').PublicCart
    >
  >;
}
export function createExperiencePortForCart(
  runtime: SharedCartRuntime
): ExperienceCartHostPort {
  const current = () =>
    runtime.generationRef.current === runtime.sessionGeneration &&
    runtime.enabled;
  const loadContinuity = async () => {
    if (!current() || !runtime.stateRef.current.cartId) return null;
    if (
      !(await ensureCartDeviceRevocationCleared(
        runtime.optionsRef.current.merchantSlug
      ))
    )
      return null;
    try {
      const r = await fetch(
        cartRoute(
          '/api/storefront/cart/continuity',
          runtime.optionsRef.current.merchantSlug
        ),
        { cache: 'no-store', credentials: 'same-origin' }
      );
      if (!r.ok || !current()) return null;
      const { experienceCartContinuitySchema } = await import(
        '@/schemas/experience-cart-continuity'
      );
      const parsed = experienceCartContinuitySchema.safeParse(await r.json());
      return current() && parsed.success ? parsed.data.fingerprint : null;
    } catch {
      return null;
    }
  };
  let storage: ReceiptStorage | null = null;
  try {
    if (typeof localStorage !== 'undefined') storage = localStorage;
  } catch {
    /* An in-memory attempt may proceed; reload replay is disabled. */
  }
  const make = (
    admit: () => AttemptAdmission<ExperienceErrorCode>,
    rebind?: (partition: string) => boolean,
    sameShopper?: () => boolean,
    refreshAdmission?: () => Promise<boolean>
  ) => {
    const get = async () => {
      const { createSharedCartCommandPort } = await import(
        './shared-cart-command-port'
      );
      return createSharedCartCommandPort({
        enabled: current,
        generation: () => runtime.generationRef.current,
        read: () => runtime.stateRef.current.confirmed,
        entries: runtime.experienceEntriesRef.current,
        receiptStorage: storage,
        admit,
        rebind,
        sameShopper,
        refreshAdmission,
        loadContinuity,
        resolveProduct: async (id) =>
          (
            await fetchSharedCartProducts(
              [id],
              runtime.optionsRef.current.merchantId
            )
          ).get(id) ?? null,
        enqueue: (operationId, intent) =>
          runtime.dispatch({
            type: 'command/enqueue',
            generation: runtime.generationRef.current,
            entry: { operationId, intent, silent: true },
          }),
      });
    };
    return {
      submit: async (
        input: Parameters<SharedCartCommandPort['submit']>[0],
        id: string
      ) => (await get()).submit(input, id),
      reconcile: async (id: string) => (await get()).reconcile(id),
    };
  };
  return {
    ...make(() => ({ allowed: false, code: 'INSUFFICIENT_SCOPE' })),
    withAdmission: make,
    readPublic: async (currency) => {
      if (!current())
        return {
          status: 'error',
          code: 'CART_ENROLLMENT_REQUIRED',
          message: 'Use native checkout.',
        };
      const state = runtime.stateRef.current.confirmed;
      if (!state)
        return {
          status: 'ok',
          value: { lines: [], total: 0, version: 1, currency },
        };
      if (!(await loadContinuity()))
        return {
          status: 'error',
          code: 'ACCOUNT_CART_REQUIRES_TRUSTED_FLOW',
          message: 'Continue with the trusted cart.',
        };
      const confirmed = runtime.stateRef.current.confirmed;
      if (!current() || !confirmed)
        return {
          status: 'error',
          code: 'CONNECTION_REVOKED',
          message: 'Use the trusted cart.',
        };
      return { status: 'ok', value: publicCartSnapshot(confirmed) };
    },
  };
}
