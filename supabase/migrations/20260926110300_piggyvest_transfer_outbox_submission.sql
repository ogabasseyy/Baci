CREATE TABLE IF NOT EXISTS public.piggyvest_transfer_submission_authorizations (
  id uuid PRIMARY KEY,
  reference text NOT NULL UNIQUE,
  customer_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  wallet_id text NOT NULL,
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  currency text NOT NULL CHECK (currency = 'NGN'),
  source_wallet_id text NOT NULL,
  destination_ref text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('bank', 'wallet')),
  provider_customer_id text NOT NULL,
  business_id text NOT NULL,
  integration_id text NOT NULL,
  state text NOT NULL DEFAULT 'authorized'
    CHECK (state IN ('authorized', 'claimed', 'consumed')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(btrim(reference)) > 0),
  CHECK (length(btrim(wallet_id)) > 0),
  CHECK (length(btrim(source_wallet_id)) > 0),
  CHECK (length(btrim(destination_ref)) > 0),
  CHECK (length(btrim(provider_customer_id)) > 0),
  CHECK (length(btrim(business_id)) > 0),
  CHECK (length(btrim(integration_id)) > 0),
  CHECK (direction <> 'bank' OR destination_ref ~ '^[0-9]{3,10}:[0-9*]{4}$')
);

CREATE TABLE IF NOT EXISTS public.piggyvest_transfer_outbox_submission_claims (
  reference text PRIMARY KEY,
  authorization_id uuid NOT NULL
    REFERENCES public.piggyvest_transfer_submission_authorizations(id),
  customer_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  wallet_id text NOT NULL,
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  currency text NOT NULL CHECK (currency = 'NGN'),
  source_wallet_id text NOT NULL,
  destination_ref text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('bank', 'wallet')),
  provider_customer_id text NOT NULL,
  business_id text NOT NULL,
  integration_id text NOT NULL,
  state text NOT NULL DEFAULT 'claimed'
    CHECK (state IN ('claimed', 'submitted', 'outcome_unknown', 'finalized')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.piggyvest_transfer_submission_authorizations
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.piggyvest_transfer_outbox_submission_claims
  ENABLE ROW LEVEL SECURITY;
