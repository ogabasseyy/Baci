/** Trusted local test composition; imported before Next starts. */
import { createClient } from '@supabase/supabase-js';
import { createPublicOutputReader } from '../../src/lib/experience/public-output-reader';
import { createPublicExperienceRuntime } from '../../src/lib/experience/public-runtime';
import { installExperienceStorefrontRuntime } from '../../src/lib/experience/storefront-runtime';
import { startPublishedGateway } from '../../tools/experience-runner/published-gateway';
export function gateway(url: string, key: string) {
  return startPublishedGateway(
    createPublicOutputReader(
      createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    ),
    'http://127.0.0.1:43174',
    43175
  );
}
export function install() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url?.startsWith('http://127.0.0.1:') || !key)
    throw Error('LOCAL_PROFILE_ONLY');
  installExperienceStorefrontRuntime(
    createPublicExperienceRuntime({
      runtimeBase: 'http://127.0.0.1:43175',
      canonicalBase: (slug) => `http://127.0.0.1:43174/${slug}`,
      client: createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
      catalogImages: new Map([
        [
          '33333333-3333-4333-8333-333333333333',
          {
            assetId: 'synthetic-device-image',
            alt: 'Synthetic blue QA device',
          },
        ],
      ]),
    })
  );
}
