// Only the existing signer for the one-RPC address-budget capability.
// No service/admin factory or unrelated caller inherits these exact paths.
const signingPath = [
  'apps/web/src/lib/address-budget/scoped-client.ts',
  'apps/web/src/lib/supabase/scoped-jwt.ts',
  'apps/web/src/lib/agentic/jwt-signing-material.ts',
  'apps/web/src/env.ts',
] as const;
const reservationPath = [
  'apps/web/src/lib/address-budget/reservation.ts',
  ...signingPath,
] as const;
const budgetPath = [
  'apps/web/src/app/api/places/provider-budget.ts',
  ...reservationPath,
] as const;
const googlePath = [
  'apps/web/src/app/api/places/google-autocomplete.ts',
  ...budgetPath,
] as const;
const geoapifyPath = [
  'apps/web/src/app/api/places/geoapify-autocomplete.ts',
  ...budgetPath,
] as const;

export const eventPipelineAddressBudgetCredentialPaths = [
  ['apps/web/src/app/api/places/autocomplete/route.ts', ...googlePath],
  ['apps/web/src/app/api/places/autocomplete/route.ts', ...geoapifyPath],
  ['apps/web/src/app/api/places/details/route.ts', ...budgetPath],
  googlePath,
  geoapifyPath,
  budgetPath,
  reservationPath,
  signingPath,
] as const;
