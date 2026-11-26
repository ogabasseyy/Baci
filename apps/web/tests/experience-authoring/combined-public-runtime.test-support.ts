import { createClient } from '@supabase/supabase-js';
import { createPublicExperienceRuntime } from '@/lib/experience/public-runtime';
import { installExperienceStorefrontRuntime } from '@/lib/experience/storefront-runtime';

/** Installed only in the disposable local Next process by the network guard. */
export function install() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url?.startsWith('http://127.0.0.1:') || !key)
    throw Error('LOCAL_FIXTURE_REQUIRED');
  installExperienceStorefrontRuntime(
    createPublicExperienceRuntime({
      client: createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
      runtimeBase: 'https://output.synthetic-output.test',
      canonicalBase: () => 'https://synthetic.synthetic.test/synthetic',
    })
  );
}
