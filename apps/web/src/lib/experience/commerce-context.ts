import type { ExperienceCommerce } from '@baci/shared/experience';
/** Delegates review to the existing engine; only the host presents navigation. */
export function createExperienceCheckout(deps: {
  settle: () => Promise<boolean>;
  refresh: () => Promise<void>;
  prepare: () => Promise<{
    ok: boolean;
    review?: { unavailableCount: number };
  }>;
  admit: () => boolean;
  present: () => void;
}): ExperienceCommerce['checkout'] {
  const denied = () => ({
    status: 'error' as const,
    code: 'STALE_ROUTE' as const,
    message: 'Continue in the trusted checkout.',
  });
  const ready = async () => {
    if (!deps.admit() || !(await deps.settle()) || !deps.admit()) return false;
    await deps.refresh();
    return deps.admit();
  };
  return {
    prepare: async () => {
      if (!(await ready())) return denied();
      const result = await deps.prepare();
      if (!deps.admit()) return denied();
      return {
        status: 'ok',
        value: { ready: result.ok && result.review?.unavailableCount === 0 },
      };
    },
    open: async () => {
      if (!(await ready())) return denied();
      deps.present();
      return { status: 'ok', value: { presented: true } };
    },
  };
}
/** Wait for the existing queue, never create a parallel checkout writer. */
export async function waitForExperienceCart(
  read: () => string | undefined,
  admit: () => boolean
): Promise<boolean> {
  const deadline = performance.now() + 8000;
  while (admit()) {
    const status = read();
    if (status === 'synced') return true;
    if (status !== 'pending' || performance.now() >= deadline) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  return false;
}
