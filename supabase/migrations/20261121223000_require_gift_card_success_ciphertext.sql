-- Rejections may have no replay body. A successful fulfillment must carry
-- nonempty encrypted evidence in addition to satisfying the capture RPC checks.
ALTER TABLE public.gift_card_wallet_orders
  ADD CONSTRAINT gift_card_success_has_ciphertext CHECK (
    provider_terminal_status IS DISTINCT FROM 'success'
      OR NULLIF(split_part(sealed_provider_replay, '.', 4), '') IS NOT NULL
  );
