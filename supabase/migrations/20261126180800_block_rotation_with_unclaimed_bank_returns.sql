-- Keep the receiving account stable until every cancellation return transfer
-- is claimed; otherwise Finance cannot claim evidence from the old account.
CREATE OR REPLACE FUNCTION private.prevent_bank_account_rotation_with_open_return_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.bank_account_id IS DISTINCT FROM NEW.bank_account_id AND (
    EXISTS (
      SELECT 1 FROM private.paid_order_offline_disbursements claim
      WHERE claim.account_id = OLD.bank_account_id AND claim.evidence_id IS NULL
    ) OR EXISTS (
      SELECT 1
      FROM private.paid_order_bank_evidence entry
      JOIN private.paid_order_amendments amendment
        ON amendment.order_id = entry.bound_order_id
        OR amendment.order_id = entry.order_id
      WHERE entry.merchant_id = OLD.merchant_id
        AND entry.account_id = OLD.bank_account_id
        AND entry.direction = 'incoming'
        AND entry.collection_method = 'bank_transfer'
        AND entry.transaction_id IS NULL
        AND ((entry.bound_order_id IS NOT NULL AND entry.allocation IS NULL)
          OR (entry.order_id IS NOT NULL AND entry.allocation = 'unapplied'))
        AND amendment.merchant_id = OLD.merchant_id
        AND amendment.state = 'settled'
        AND amendment.hold_fulfillment
        AND EXISTS (
          SELECT 1 FROM private.paid_order_amendment_events event
          WHERE event.amendment_id = amendment.id
            AND event.event_type = 'verified_cancellation_opened'
        )
    )
  ) THEN
    RAISE EXCEPTION 'bank_return_claim_open';
  END IF;
  RETURN NEW;
END;
$$;
