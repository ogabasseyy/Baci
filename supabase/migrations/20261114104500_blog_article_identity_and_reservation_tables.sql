BEGIN;

-- 1. Durable identity and requested slot columns on public.blog_posts
ALTER TABLE public.blog_posts
  ADD COLUMN IF NOT EXISTS article_identity uuid,
  ADD COLUMN IF NOT EXISTS requested_publish_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS blog_posts_merchant_article_identity_key
  ON public.blog_posts (merchant_id, article_identity)
  WHERE article_identity IS NOT NULL;

COMMENT ON COLUMN public.blog_posts.article_identity IS
  'Immutable per-merchant UUID identifying a single editorial article across retries and legacy adoption.';
COMMENT ON COLUMN public.blog_posts.requested_publish_at IS
  'Originally requested publication timestamp; preserved when blog_posts.published_at records actual DB publication time or deferred evaluation.';

-- 2. Private reservation table
CREATE TABLE IF NOT EXISTS private.blog_release_reservations (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  post_id uuid NOT NULL,
  article_identity uuid NOT NULL,
  request_id text NOT NULL CHECK (char_length(pg_catalog.btrim(request_id)) BETWEEN 1 AND 200),
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  policy_version text NOT NULL CHECK (char_length(pg_catalog.btrim(policy_version)) BETWEEN 1 AND 80),
  release_class text NOT NULL CHECK (release_class IN ('evergreen', 'fast_track_news', 'standard')),
  task_type text,
  category text,
  is_low_demand_game_software boolean NOT NULL DEFAULT false,
  requested_publish_at timestamptz NOT NULL,
  reserved_lagos_date date NOT NULL,
  event_published_at timestamptz,
  daily_cap integer NOT NULL CHECK (daily_cap >= 0),
  fast_track_cap integer NOT NULL CHECK (fast_track_cap BETWEEN 0 AND 2),
  evergreen_min_reserve integer NOT NULL CHECK (evergreen_min_reserve >= 0),
  min_spacing_minutes integer NOT NULL DEFAULT 30 CHECK (min_spacing_minutes >= 0),
  window_start_hour integer NOT NULL DEFAULT 8 CHECK (window_start_hour BETWEEN 0 AND 23),
  window_end_hour integer NOT NULL DEFAULT 20 CHECK (
    window_end_hour BETWEEN 0 AND 23 AND window_end_hour >= window_start_hour
  ),
  state text NOT NULL CHECK (
    state IN ('reserved', 'published', 'cancelled', 'deferred', 'held_expired_news')
  ),
  defer_reason text,
  next_evaluation_at timestamptz,
  actual_published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT blog_release_reservations_post_merchant_fkey
    FOREIGN KEY (post_id, merchant_id)
    REFERENCES public.blog_posts(id, merchant_id)
    ON DELETE CASCADE,
  CONSTRAINT blog_release_reservations_merchant_request_key
    UNIQUE (merchant_id, request_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS blog_release_reservations_active_post_key
  ON private.blog_release_reservations (merchant_id, post_id)
  WHERE state IN ('reserved', 'deferred');

CREATE UNIQUE INDEX IF NOT EXISTS blog_release_reservations_active_identity_key
  ON private.blog_release_reservations (merchant_id, article_identity)
  WHERE state IN ('reserved', 'deferred');

CREATE INDEX IF NOT EXISTS blog_release_reservations_merchant_date_state_idx
  ON private.blog_release_reservations (merchant_id, reserved_lagos_date, state);

CREATE INDEX IF NOT EXISTS blog_release_reservations_post_idx
  ON private.blog_release_reservations (post_id, state);

ALTER TABLE private.blog_release_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.blog_release_reservations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.blog_release_reservations
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS private.blog_release_requests (
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  request_id text NOT NULL CHECK (char_length(pg_catalog.btrim(request_id)) BETWEEN 1 AND 200),
  reservation_id uuid NOT NULL REFERENCES private.blog_release_reservations(id) ON DELETE CASCADE,
  operation text NOT NULL CHECK (operation IN ('reserve', 'reschedule')),
  post_id uuid NOT NULL,
  article_identity uuid NOT NULL,
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (merchant_id, request_id)
);

CREATE INDEX IF NOT EXISTS blog_release_requests_reservation_idx
  ON private.blog_release_requests (reservation_id);

ALTER TABLE private.blog_release_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.blog_release_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.blog_release_requests
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
