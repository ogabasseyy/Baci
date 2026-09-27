/**
 * Re-export of the single shared PiggyVest savings-policy implementation in
 * `packages/shared/src/piggyvest/savings-policy.ts`.
 *
 * This module used to mirror the web copy by hand; the authoritative
 * implementation now lives in `@baci/shared` so the client preview and the
 * backend can never drift on activation, pricing, or maturity decisions.
 * Import from here or from `@baci/shared` directly.
 */
export * from '@baci/shared/piggyvest';
