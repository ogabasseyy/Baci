import { readFileSync } from 'node:fs';
import type { createCommerceEngineFixture } from './cart-engine-fixture';

/** Baseline writer columns only; actual main ingress functions/policies, not fake responses. */
export async function prepareAnalyticsFixture(
  f: Awaited<ReturnType<typeof createCommerceEngineFixture>>
) {
  await f.pool.query(`
    CREATE TABLE public.analytics_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      merchant_id uuid NOT NULL REFERENCES merchants(id),
      event_type text NOT NULL, event_data jsonb NOT NULL,
      event_timestamp timestamptz DEFAULT now(), created_at timestamptz DEFAULT now(),
      event_id text, source text DEFAULT 'web',
      UNIQUE(merchant_id,event_id,event_type)
    );
    CREATE INDEX ON public.analytics_events(merchant_id);
    CREATE TABLE public.platform_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id uuid REFERENCES merchants(id),
      event_type text NOT NULL, event_data jsonb DEFAULT '{}', event_id text,
      event_timestamp timestamptz DEFAULT now()
    );
    CREATE INDEX ON public.platform_events(merchant_id);
    ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.platform_events ENABLE ROW LEVEL SECURITY;
    GRANT INSERT,SELECT ON public.analytics_events,public.platform_events TO anon;
  `);
  for (const name of [
    '20260714000200_scope_public_event_ingress.sql',
    '20260714000300_allow_tenant_verified_event_ingress_fallback.sql',
  ])
    await f.pool.query(
      readFileSync(
        new URL(`../../../../supabase/migrations/${name}`, import.meta.url),
        'utf8'
      )
    );
}
