-- Restore invoice DVA terms that were truncated by the original 90-minute
-- clamp migration. Immediate invoices use the order issue timestamp plus the
-- fourteen-day term; invoices with an explicit payment_due_date use that
-- persisted due date instead.
--
-- Every candidate is re-read after the order and receiver advisory locks are
-- held. The ownership checks and expiry update therefore share one serialized
-- transaction with the runtime reservation paths. A receiver that has been
-- claimed by another order, a customer wallet, or an active checkout session
-- is left unchanged rather than being reactivated by this repair.

-- This is a trusted, append-only repair. The timestamp-bound trigger added in
-- the preceding migration permits the service-role claim used only for this
-- migration transaction so explicit invoice terms can be restored.
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_candidate record;
  v_current record;
BEGIN
  -- Advisory locks are transaction-scoped. Acquire every candidate order lock
  -- in deterministic order before acquiring any receiver lock, so the repair
  -- never waits on an order while retaining a receiver lock from an earlier
  -- candidate in the loop.
  FOR v_candidate IN
    SELECT DISTINCT account.order_id
    FROM public.order_payment_accounts AS account
    JOIN public.orders AS orders ON orders.id = account.order_id
    WHERE account.provider = 'paystack'
      AND lower(trim(COALESCE(orders.payment_method, ''))) = 'invoice'
      AND account.expires_at IS NOT NULL
      AND NULLIF(trim(account.account_number), '') IS NOT NULL
    ORDER BY account.order_id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'baci_order_payment:' || v_candidate.order_id::text, 0
      )
    );
  END LOOP;

  FOR v_candidate IN
    SELECT DISTINCT NULLIF(trim(account.account_number), '') AS account_number
    FROM public.order_payment_accounts AS account
    JOIN public.orders AS orders ON orders.id = account.order_id
    WHERE account.provider = 'paystack'
      AND lower(trim(COALESCE(orders.payment_method, ''))) = 'invoice'
      AND account.expires_at IS NOT NULL
      AND NULLIF(trim(account.account_number), '') IS NOT NULL
    ORDER BY account_number
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'paystack_order_account:' || v_candidate.account_number, 0
      )
    );
  END LOOP;

  FOR v_candidate IN
    SELECT DISTINCT ON (
      account.order_id,
      NULLIF(trim(account.account_number), '')
    )
      account.id,
      account.order_id,
      NULLIF(trim(account.account_number), '') AS account_number
    FROM public.order_payment_accounts AS account
    JOIN public.orders AS orders ON orders.id = account.order_id
    WHERE account.provider = 'paystack'
      AND lower(trim(COALESCE(orders.payment_method, ''))) = 'invoice'
      AND account.expires_at IS NOT NULL
    ORDER BY
      account.order_id,
      NULLIF(trim(account.account_number), ''),
      COALESCE(account.assigned_at, account.created_at) DESC NULLS LAST,
      account.created_at DESC NULLS LAST,
      account.id DESC
  LOOP
    IF v_candidate.account_number IS NULL THEN
      CONTINUE;
    END IF;

    -- Re-read and lock the rows after both advisory locks. This prevents a
    -- stale candidate snapshot from changing ownership during the repair.
    SELECT
      account.id,
      account.order_id,
      NULLIF(trim(account.account_number), '') AS account_number,
      account.expires_at AS current_expires_at,
      COALESCE(account.assigned_at, account.created_at)
        + interval '90 minutes' AS clamped_expiry,
      orders.cancelled_at,
      orders.shipping_status,
      orders.payment_status,
      CASE
        WHEN orders.payment_due_date IS NOT NULL
          -- payment_due_date is a calendar date. Use the following midnight
          -- as the exclusive bound so the advertised due date remains valid
          -- through its final instant.
          THEN (orders.payment_due_date + 1)::timestamptz
        ELSE COALESCE(
          orders.created_at,
          account.assigned_at,
          account.created_at
        ) + interval '14 days'
      END AS invoice_expiry,
      GREATEST(
        COALESCE(orders.total, 0) - GREATEST(
          COALESCE(orders.amount_paid, 0),
          COALESCE((
            SELECT sum(COALESCE(transactions.amount, 0))
            FROM public.transactions AS transactions
            WHERE transactions.order_id = orders.id
              AND transactions.merchant_id = orders.merchant_id
              AND transactions.transaction_type = 'payment'
              AND transactions.status IN ('success', 'completed')
          ), 0)
          + GREATEST(
            0,
            COALESCE(orders.wallet_amount_used, 0) - COALESCE((
              SELECT sum(COALESCE(transactions.amount, 0))
              FROM public.transactions AS transactions
              WHERE transactions.order_id = orders.id
                AND transactions.merchant_id = orders.merchant_id
                AND transactions.transaction_type = 'payment'
                AND transactions.status IN ('success', 'completed')
                AND lower(COALESCE(transactions.gateway, '')) IN (
                  'wallet', 'store_credit'
                )
            ), 0)
          )
          + COALESCE((
            SELECT sum(COALESCE(redemptions.amount, 0))
            FROM public.customer_savings_redemptions AS redemptions
            WHERE redemptions.order_id = orders.id
              AND redemptions.merchant_id = orders.merchant_id
              AND redemptions.metadata ->> 'reversed_at' IS NULL
          ), 0)
        ),
        0
      ) AS remaining_balance
    INTO v_current
    FROM public.order_payment_accounts AS account
    JOIN public.orders AS orders ON orders.id = account.order_id
    WHERE account.order_id = v_candidate.order_id
      AND NULLIF(trim(account.account_number), '') = v_candidate.account_number
      AND account.provider = 'paystack'
      AND lower(trim(COALESCE(orders.payment_method, ''))) = 'invoice'
    ORDER BY
      COALESCE(account.assigned_at, account.created_at) DESC NULLS LAST,
      account.created_at DESC NULLS LAST,
      account.id DESC
    LIMIT 1
    FOR UPDATE OF account, orders;

    IF NOT FOUND OR v_current.account_number IS NULL THEN
      CONTINUE;
    END IF;

    -- A terminal order must not regain an invoice receiver. Re-read the
    -- lifecycle and reconciled payable balance while the order row is locked;
    -- webhook candidate normalization rejects these states as well.
    IF v_current.cancelled_at IS NOT NULL
      OR v_current.shipping_status IN ('cancelled', 'canceled')
      OR COALESCE(v_current.payment_status, '') NOT IN (
        'pending', 'unpaid', 'partially_paid'
      )
      OR v_current.remaining_balance <= 0 THEN
      CONTINUE;
    END IF;

    IF v_current.invoice_expiry IS NULL
      OR v_current.clamped_expiry IS NULL
      OR v_current.invoice_expiry <= v_current.clamped_expiry
      OR v_current.current_expires_at IS DISTINCT FROM v_current.clamped_expiry THEN
      CONTINUE;
    END IF;

    -- Do not revive this receiver when another active owner already holds it.
    IF EXISTS (
      SELECT 1
      FROM public.order_payment_accounts AS other
      WHERE other.id <> v_current.id
        AND other.provider = 'paystack'
        AND trim(other.account_number) = v_current.account_number
        AND COALESCE(
          other.expires_at,
          other.assigned_at + interval '90 minutes',
          other.created_at + interval '90 minutes'
        ) > now()
    ) OR EXISTS (
      SELECT 1
      FROM public.customer_wallet_payment_accounts AS wallet
      WHERE wallet.provider = 'paystack'
        AND wallet.account_number = v_current.account_number
        AND wallet.status = 'active'
    ) OR EXISTS (
      SELECT 1
      FROM public.checkout_sessions AS checkout
      WHERE checkout.virtual_account_number = v_current.account_number
        AND checkout.payment_provider = 'paystack'
        AND checkout.status IN ('pending', 'processing')
        AND COALESCE(
          checkout.virtual_account_expires_at,
          checkout.expires_at
        ) > now()
    ) THEN
      CONTINUE;
    END IF;

    UPDATE public.order_payment_accounts AS account
    SET expires_at = v_current.invoice_expiry
    WHERE account.id = v_current.id
      AND account.expires_at = v_current.clamped_expiry;
  END LOOP;
END;
$$;
