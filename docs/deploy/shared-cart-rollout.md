# Shared server cart: rollout and operational recovery

Status: prepared only. Nothing in this document has been executed
against production. Migrations are registered as pending, feature
flags remain disabled by default, and no merchant is enrolled.

## Controls that already exist

- Merchant-scoped enrollment flags (`shared_cart`, `shared_cart_realtime`,
  `shared_cart_native`, `shared_cart_accounts`) via `merchantHasFeature`;
  explicit grant only, disabled for all plans by default.
- Bounded retention: `cleanup_commerce_carts()` deletes only expired
  operations/creation requests/events and flips only checkout-free
  expired carts (`checkout_session_id IS NULL`); active checkouts and
  unexpired retry receipts are spared.
- Transactional outbox publisher with leases, bounded backoff and
  dead-letter handling (local unit/SQL evidence; live qualification
  pending).
- Device-scoped revocation (`commerce_cart_revoke_device_grants`) used
  by native retirement and web sign-out; it never clears cart contents.
- Worker credential boundary: the `commerce_cart_worker` role's event
  policies are intentionally unscoped (`USING (true)`) because the
  publisher drains every merchant's outbox. That credential must stay
  worker-only — never provision it to web, native, or any
  shopper-facing surface — and prefer constraining the role to the
  publish RPC path before enabling `shared_cart_realtime` in
  production.

## Release sequence (requires separate authorization)

1. Review and commit this worktree; regenerate frozen inventories and
   obtain the required review at the exact SHA.
2. Apply pending cart migrations additively; provision cart roles and
   signing material through the approved environment process (no `.env`
   edits are part of this change set).
3. Deploy compatible server adapters with enrollment still disabled.
4. Pilot one controlled merchant (Ogabassey), run the acceptance matrix
   in `docs/qa/shared-cart-acceptance.md`, then a second merchant.
5. Expand only after convergence, checkout-binding and isolation
   evidence pass at the deployed revision.

## Rollback

- Disable new enrollment/realtime first. Migrated carts keep canonical
  ownership; never restore stale local carts as authoritative and never
  drop the canonical tables as a rollback step.
- Keep the last compatible server version available while clients
  drain. Native/web clients retain foreground HTTP recovery when
  realtime is disabled.

## Observability gaps to close before activation

- No production dashboards/alerts exist yet for mutation latency,
  version conflicts, replay rate, rejected access, handoff completion,
  realtime join/reconnect lag, or checkout version mismatches. Add
  nonsecret metrics (no cart credentials or customer data in labels)
  during the authorized release, and qualify the outbox publisher
  against the real worker scheduler.
