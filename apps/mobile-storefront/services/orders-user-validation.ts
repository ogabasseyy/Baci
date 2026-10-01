import type { SupabaseClient } from '@supabase/supabase-js';

const CHECKOUT_USER_VALIDATION_TIMEOUT_MS = 4_000;

export async function validateCheckoutUser(
  auth: Pick<SupabaseClient['auth'], 'getUser'>,
  accessToken: string
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{
    data: { user: null };
    error: Error;
  }>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          data: { user: null },
          error: new Error('Checkout user validation timed out'),
        }),
      CHECKOUT_USER_VALIDATION_TIMEOUT_MS
    );
  });

  try {
    return await Promise.race([auth.getUser(accessToken), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
