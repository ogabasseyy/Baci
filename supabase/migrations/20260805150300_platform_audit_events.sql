-- Immutable, platform-wide operator audit ledger and privacy-safe timeline.
-- This deliberately does not repurpose legacy audit_logs, whose JSON payloads
-- may contain fields that are unsafe to expose in an admin activity feed.

BEGIN;

CREATE OR REPLACE FUNCTION private.platform_audit_token_valid_v1(
  p_value text,
  p_max_length integer
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_value IS NOT NULL
    AND char_length(p_value) BETWEEN 1 AND p_max_length
    AND p_value ~ '^[a-z0-9][a-z0-9._:-]*$';
$$;

REVOKE ALL ON FUNCTION private.platform_audit_token_valid_v1(text, integer)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.platform_audit_changed_fields_valid_v1(
  p_fields text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE(array_length(p_fields, 1), 0) <= 64
    AND COALESCE(octet_length(array_to_string(p_fields, ',')), 0) <= 4096
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(p_fields, ARRAY[]::text[])) AS field_name(name)
      WHERE NOT private.platform_audit_token_valid_v1(field_name.name, 64)
    );
$$;

REVOKE ALL ON FUNCTION private.platform_audit_changed_fields_valid_v1(text[])
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.platform_audit_metadata_valid_v1(
  p_metadata jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_typeof(COALESCE(p_metadata, '{}'::jsonb)) = 'object'
    AND (SELECT count(*) FROM jsonb_object_keys(COALESCE(p_metadata, '{}'::jsonb))) <= 8
    AND octet_length(COALESCE(p_metadata, '{}'::jsonb)::text) <= 1024
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_each_text(COALESCE(p_metadata, '{}'::jsonb)) AS entry(key, value)
      WHERE entry.key NOT IN ('category', 'operation', 'reason_code', 'result')
        OR NOT private.platform_audit_token_valid_v1(entry.value, 64)
    );
$$;

REVOKE ALL ON FUNCTION private.platform_audit_metadata_valid_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.platform_audit_events (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  actor_user_id uuid NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  changed_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT platform_audit_events_action_check CHECK (
    private.platform_audit_token_valid_v1(action, 100)
  ),
  CONSTRAINT platform_audit_events_resource_type_check CHECK (
    private.platform_audit_token_valid_v1(resource_type, 80)
  ),
  CONSTRAINT platform_audit_events_resource_id_check CHECK (
    private.platform_audit_token_valid_v1(resource_id, 160)
  ),
  CONSTRAINT platform_audit_events_changed_fields_check CHECK (
    private.platform_audit_changed_fields_valid_v1(changed_fields)
  ),
  CONSTRAINT platform_audit_events_metadata_check CHECK (
    private.platform_audit_metadata_valid_v1(metadata)
  )
);

ALTER TABLE public.platform_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_audit_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_audit_events
  FROM PUBLIC, anon, authenticated, service_role;

-- Global keyset-reader indexes. These intentionally do not start with a
-- merchant because the platform timeline is cross-tenant by design.
CREATE INDEX idx_platform_audit_events_global_occurred_id
  ON public.platform_audit_events (occurred_at DESC, id DESC);
CREATE INDEX idx_platform_audit_events_global_action_occurred_id
  ON public.platform_audit_events (action, occurred_at DESC, id DESC);
CREATE INDEX idx_platform_audit_events_global_resource_type_occurred_id
  ON public.platform_audit_events (resource_type, occurred_at DESC, id DESC);

COMMIT;
