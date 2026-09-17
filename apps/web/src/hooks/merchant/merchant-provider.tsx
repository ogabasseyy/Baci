'use client';

import { useEffect, useState } from 'react';
import { useAuthSafe } from '@/contexts/auth-context';
import { logger } from '@/lib/logger';
import { permissionGrantsAccess } from '@/lib/permission-grant';
import type { createClient } from '@/lib/supabase/client';
import { defaultStaffAccess } from './constants';
import { fetchDashboardMerchantViaApi } from './fetch-dashboard-merchant-via-api';
import { MerchantContext } from './merchant-context';
import { getDemoMerchant } from './mock-data';
import { fetchMerchantBySlug, fetchPrimaryDomain } from './queries';
import type {
  MerchantContextType,
  MerchantData,
  MerchantProviderProps,
  StaffAccess,
} from './types';
import { createMerchantUpdate } from './update-merchant-data';

type SupabaseClient = ReturnType<typeof createClient>;
interface LoadBySlugArgs {
  supabase: SupabaseClient;
  slug: string;
  isCancelled: () => boolean;
  setMerchant: (merchant: MerchantData | null) => void;
  setLoading: (loading: boolean) => void;
}

// Module scope: React Compiler cannot lower dynamic import() inside the
// provider. Lazy so the generic branch's static supabase edge (which every
// storefront page ships via the server-awaited page.tsx branch union) becomes
// load-on-first-merchant-fetch instead.
async function loadSupabaseClient(): Promise<ReturnType<typeof createClient>> {
  const { createClient } = await import('@/lib/supabase/client');
  return createClient();
}

let supabaseClientPromise: Promise<ReturnType<typeof createClient>> | null =
  null;

// Module scope: stable across renders (no exhaustive-deps churn) and out of
// the React Compiler-lowered provider. The browser client is process-wide
// state anyway; every caller shares the first resolution.
function getSupabaseClient(): Promise<ReturnType<typeof createClient>> {
  if (!supabaseClientPromise) {
    supabaseClientPromise = loadSupabaseClient();
  }
  return supabaseClientPromise;
}

// Module scope keeps try/finally out of the React Compiler-lowered provider.
async function loadMerchantBySlug({
  supabase,
  slug,
  isCancelled,
  setMerchant,
  setLoading,
}: LoadBySlugArgs): Promise<void> {
  try {
    const data = await fetchMerchantBySlug(supabase, slug);
    if (isCancelled()) return;

    if (data?.id) {
      const domain = await fetchPrimaryDomain(supabase, data.id);
      if (!isCancelled() && domain) data.custom_domain = domain;
    }

    if (!isCancelled()) setMerchant(data);
  } catch (error) {
    logger.error({
      message: `Failed to load merchant by slug: ${slug}. Error: ${(error as Error).message}`,
    });
    if (!isCancelled()) setMerchant(null);
  } finally {
    if (!isCancelled()) setLoading(false);
  }
}

interface LoadDashboardArgs {
  isCancelled: () => boolean;
  setMerchant: (merchant: MerchantData | null) => void;
  setStaffAccess: (access: StaffAccess) => void;
  setLoading: (loading: boolean) => void;
}

async function loadDashboardMerchant({
  isCancelled,
  setMerchant,
  setStaffAccess,
  setLoading,
}: LoadDashboardArgs): Promise<void> {
  try {
    // Reads the own-merchant context (incl. sensitive columns + primary domain)
    // through the /api/merchant/me server boundary rather than the browser's
    // authenticated Supabase client — see fetch-dashboard-merchant-via-api.ts.
    const result = await fetchDashboardMerchantViaApi();
    if (isCancelled()) return;

    setMerchant(result.merchant);
    setStaffAccess(result.staffAccess);
  } catch (error) {
    logger.error({
      message: `Failed to load merchant data. Error: ${(error as Error).message}`,
    });
    if (!isCancelled()) {
      setMerchant(null);
      setStaffAccess(defaultStaffAccess);
    }
  } finally {
    if (!isCancelled()) setLoading(false);
  }
}

interface ReloadBySlugArgs {
  getSupabase: () => Promise<ReturnType<typeof createClient>>;
  slug: string;
  setMerchant: (merchant: MerchantData | null) => void;
  setLoading: (loading: boolean) => void;
}

// Module scope keeps try/finally out of the React Compiler-lowered provider.
async function reloadMerchantBySlug({
  getSupabase,
  slug,
  setMerchant,
  setLoading,
}: ReloadBySlugArgs): Promise<void> {
  try {
    const supabase = await getSupabase();
    const data = await fetchMerchantBySlug(supabase, slug);
    if (data?.id) {
      const domain = await fetchPrimaryDomain(supabase, data.id);
      if (domain) data.custom_domain = domain;
    }
    setMerchant(data);
  } catch (error) {
    logger.error({
      message: `Reload failed: ${(error as Error).message}`,
    });
  } finally {
    setLoading(false);
  }
}

export const MerchantProvider = ({
  children,
  slug,
  initialMerchant,
  initialStaffAccess,
  initialRoutingMode,
  navigationCategories = [],
}: MerchantProviderProps) => {
  const auth = useAuthSafe();
  const user = auth?.user ?? null;
  const authLoading = auth?.loading ?? false;

  // Resolve demo merchants synchronously so data is ready on the first commit.
  const initialDemoMerchant =
    !initialMerchant && slug ? getDemoMerchant(slug) : null;

  const [merchant, setMerchant] = useState<MerchantData | null>(
    initialMerchant ?? initialDemoMerchant ?? null
  );
  const [loading, setLoading] = useState(
    !initialMerchant && !initialDemoMerchant
  );
  const [staffAccess, setStaffAccess] = useState<StaffAccess>(
    initialStaffAccess ?? defaultStaffAccess
  );

  // When the slug prop changes, re-resolve any demo merchant during render
  // (via a prev-prop comparison) instead of an effect. Real slugs/users are
  // loaded async in the effect below.
  const [prevSlug, setPrevSlug] = useState(slug);
  if (slug !== prevSlug) {
    setPrevSlug(slug);
    if (!initialMerchant && slug) {
      const demoMerchant = getDemoMerchant(slug);
      if (demoMerchant) {
        setMerchant(demoMerchant);
        setLoading(false);
      }
    }
  }

  // Flip `loading` on during render (a prev-key comparison) whenever the inputs
  // that trigger a fresh async load change, instead of calling setLoading(true)
  // synchronously inside the effect — that forces an extra render where stale
  // (not-loading) state is briefly visible. The effect below only resolves the
  // data and turns loading back off via the module-scope loaders.
  const willFetchBySlug =
    !initialMerchant && Boolean(slug) && !getDemoMerchant(slug ?? '');
  const willFetchDashboard =
    !initialMerchant && !slug && !authLoading && Boolean(user);
  // Dashboard mode with auth resolved but no signed-in user → signed-out reset.
  const isAnonDashboard = !initialMerchant && !slug && !authLoading && !user;
  const fetchLoadingKey = initialMerchant
    ? 'static'
    : willFetchBySlug
      ? `slug:${slug}`
      : willFetchDashboard
        ? `user:${user?.id ?? ''}`
        : isAnonDashboard
          ? 'anon'
          : 'idle';
  // Seed an "init" sentinel so the first render always reconciles loading with
  // the resolved fetch state (e.g. an immediate signed-out reset on mount).
  const [prevFetchLoadingKey, setPrevFetchLoadingKey] = useState('init');
  if (fetchLoadingKey !== prevFetchLoadingKey) {
    setPrevFetchLoadingKey(fetchLoadingKey);
    if (willFetchBySlug || willFetchDashboard) {
      setLoading(true);
    } else if (isAnonDashboard) {
      // Mirror the signed-out reset during render instead of in the effect so
      // no stale merchant is briefly shown after logout.
      setMerchant(null);
      setStaffAccess(defaultStaffAccess);
      setLoading(false);
    }
  }

  const routingMode = initialRoutingMode ?? 'path';
  const basePath =
    routingMode === 'domain' ? '' : `/${merchant?.slug || slug || ''}`;

  // The Supabase client resolves once per process via the module-scope
  // getSupabaseClient — never constructed for readers that only consume SSR
  // merchant data, and stable across renders for effect dependencies.

  // ---- DATA LOADING ----
  // CASE 1: initialMerchant provided → no fetch (dashboard + storefront with SSR data)
  // CASE 2: slug provided, no initialMerchant → demo check or fetchMerchantBySlug
  // CASE 3: no slug, no initialMerchant → wait for auth, then load the dashboard
  // merchant via the /api/merchant/me server boundary

  useEffect(() => {
    // CASE 1: Server-provided data — trust it, skip fetch
    if (initialMerchant) return;

    // CASE 2: Storefront mode (slug, no initial data)
    if (slug) {
      // Demo merchants are resolved synchronously during render (see below).
      if (getDemoMerchant(slug)) return;

      // `loading` is flipped on during render (see fetchLoadingKey above).
      let cancelled = false;

      void (async () => {
        const supabase = await getSupabaseClient();
        if (cancelled) return;
        await loadMerchantBySlug({
          supabase,
          slug,
          isCancelled: () => cancelled,
          setMerchant,
          setLoading,
        });
      })();

      return () => {
        cancelled = true;
      };
    }

    // CASE 3: Dashboard/Builder mode (no slug, no initial data)
    if (authLoading) return;
    // Signed-out reset is handled during render (see fetchLoadingKey above).
    if (!user) return;

    // `loading` is flipped on during render (see fetchLoadingKey above).
    let cancelled = false;

    void loadDashboardMerchant({
      isCancelled: () => cancelled,
      setMerchant,
      setStaffAccess,
      setLoading,
    });

    return () => {
      cancelled = true;
    };
  }, [slug, authLoading, user?.id, initialMerchant, user]);

  // ---- ACTIONS ----

  const reloadMerchant = () => {
    setLoading(true);

    if (slug) {
      void reloadMerchantBySlug({
        getSupabase: getSupabaseClient,
        slug,
        setMerchant,
        setLoading,
      });
    } else if (user) {
      fetchDashboardMerchantViaApi()
        .then((result) => {
          setMerchant(result.merchant);
          setStaffAccess(result.staffAccess);
        })
        .catch((error) => {
          logger.error({
            message: `Reload failed: ${(error as Error).message}`,
          });
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  };

  const updateMerchant = createMerchantUpdate({
    getSupabase: getSupabaseClient,
    userId: user?.id ?? null,
    staffAccess,
    activeMerchantId: merchant?.id,
    setMerchant,
    reloadMerchant,
  });

  const hasPermission = (resource: string, action: string): boolean => {
    if (staffAccess.isOwner) return true;
    if (!staffAccess.isStaff) return false;
    return permissionGrantsAccess(staffAccess.permissions, resource, action);
  };

  const value: MerchantContextType = {
    merchant,
    loading,
    updateMerchant,
    reloadMerchant,
    staffAccess,
    hasPermission,
    routingMode,
    basePath,
    navigationCategories,
  };

  return (
    <MerchantContext.Provider value={value}>
      {children}
    </MerchantContext.Provider>
  );
};
