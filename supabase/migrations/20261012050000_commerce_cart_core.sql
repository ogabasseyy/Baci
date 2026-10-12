-- Canonical shared server cart: tables, constraints, indexes and RLS enablement.
-- Roles, grants and RLS policies live in the companion commerce_cart_roles
-- migration so each layer is reviewable on its own. Additive only.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.commerce_carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL,
  currency text NOT NULL DEFAULT 'NGN' CHECK (currency ~ '^[A-Z]{3}$'),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  state text NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'checkout', 'completed', 'expired', 'canceled')),
  checkout_session_id uuid NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, id)
);

CREATE TABLE IF NOT EXISTS public.commerce_cart_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL,
  cart_id uuid NOT NULL,
  product_id uuid NOT NULL,
  variant_id uuid NULL,
  condition text NULL CHECK (condition IN ('new', 'used', 'open_box', 'refurbished')),
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  quantity integer NOT NULL CHECK (quantity >= 1 AND quantity <= 10),
  negotiated_unit_price_minor integer NULL CHECK (negotiated_unit_price_minor >= 0),
  negotiation_status text NULL CHECK (negotiation_status IN ('pending', 'accepted', 'rejected')),
  voucher_token text NULL,
  voucher_award_id uuid NULL,
  has_assurance boolean NOT NULL DEFAULT false,
  assurance_rate numeric NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (merchant_id, cart_id)
    REFERENCES public.commerce_carts (merchant_id, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.commerce_cart_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL,
  cart_id uuid NOT NULL,
  principal_id text NOT NULL,
  principal_type text NOT NULL DEFAULT 'guest'
    CHECK (principal_type IN ('guest', 'device', 'customer', 'platform')),
  allowed_operations text[] NOT NULL DEFAULT '{add,set_quantity,remove,clear}',
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (merchant_id, cart_id)
    REFERENCES public.commerce_carts (merchant_id, id)
    ON DELETE CASCADE,
  UNIQUE (cart_id, principal_id)
);

CREATE TABLE IF NOT EXISTS public.commerce_cart_operations (
  merchant_id uuid NOT NULL,
  cart_id uuid NOT NULL,
  principal_id text NOT NULL,
  operation_id text NOT NULL,
  request_digest text NOT NULL,
  result jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (merchant_id, cart_id, principal_id, operation_id),
  FOREIGN KEY (merchant_id, cart_id)
    REFERENCES public.commerce_carts (merchant_id, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.commerce_cart_creation_requests (
  merchant_id uuid NOT NULL,
  principal_id text NOT NULL,
  operation_id text NOT NULL,
  request_digest text NOT NULL,
  cart_id uuid NULL,
  grant_id uuid NULL,
  result jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (merchant_id, principal_id, operation_id),
  FOREIGN KEY (merchant_id, cart_id)
    REFERENCES public.commerce_carts (merchant_id, id)
    ON DELETE SET NULL (cart_id),
  FOREIGN KEY (grant_id)
    REFERENCES public.commerce_cart_grants (id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.commerce_cart_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handoff_hash text NOT NULL UNIQUE,
  merchant_id uuid NOT NULL,
  source_cart_id uuid NOT NULL,
  destination_attempt_id text NULL,
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz NULL,
  redemption_receipt jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (merchant_id, source_cart_id)
    REFERENCES public.commerce_carts (merchant_id, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.commerce_cart_legacy_refs (
  merchant_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('mcp', 'ucp')),
  legacy_hash text NOT NULL,
  cart_id uuid NOT NULL,
  receipt jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant_id, provider, legacy_hash),
  FOREIGN KEY (merchant_id, cart_id)
    REFERENCES public.commerce_carts (merchant_id, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.commerce_cart_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  merchant_id uuid NOT NULL,
  cart_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  operation_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  locked_at timestamptz NULL,
  locked_by text NULL,
  attempts integer NOT NULL DEFAULT 0,
  delivered_at timestamptz NULL,
  UNIQUE (cart_id, version),
  FOREIGN KEY (merchant_id, cart_id)
    REFERENCES public.commerce_carts (merchant_id, id)
    ON DELETE CASCADE
);

ALTER TABLE public.commerce_carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_cart_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_cart_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_cart_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_cart_creation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_cart_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_cart_legacy_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_cart_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS commerce_cart_lines_cart_idx
  ON public.commerce_cart_lines (merchant_id, cart_id);
CREATE INDEX IF NOT EXISTS commerce_cart_grants_cart_idx
  ON public.commerce_cart_grants (merchant_id, cart_id);
CREATE INDEX IF NOT EXISTS commerce_cart_operations_cart_idx
  ON public.commerce_cart_operations (merchant_id, cart_id);
CREATE INDEX IF NOT EXISTS commerce_cart_creation_requests_principal_idx
  ON public.commerce_cart_creation_requests (merchant_id, principal_id);
CREATE INDEX IF NOT EXISTS commerce_cart_handoffs_source_idx
  ON public.commerce_cart_handoffs (merchant_id, source_cart_id);
CREATE INDEX IF NOT EXISTS commerce_cart_events_cart_idx
  ON public.commerce_cart_events (merchant_id, cart_id);
CREATE INDEX IF NOT EXISTS commerce_carts_expiry_idx
  ON public.commerce_carts (expires_at);
CREATE INDEX IF NOT EXISTS commerce_cart_grants_expiry_idx
  ON public.commerce_cart_grants (expires_at);
CREATE INDEX IF NOT EXISTS commerce_cart_events_outbox_idx
  ON public.commerce_cart_events (delivered_at, locked_at)
  WHERE delivered_at IS NULL;
