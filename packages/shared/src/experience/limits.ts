/** Wire budgets; source is ordinary code, never an interaction DSL. */
export const EXPERIENCE_LIMITS = {
  files: 128,
  sourceBytes: 4 * 1024 * 1024,
  fileBytes: 512 * 1024,
  chunkBytes: 32 * 1024,
  jsonResponseBytes: 96 * 1024,
  bridgeBytes: 16 * 1024,
} as const;
export const EXPERIENCE_METHOD_CAPABILITY = {
  'catalog.collection': 'catalog.read',
  'catalog.product': 'catalog.read',
  'catalog.variants': 'catalog.read',
  'cart.readPublic': 'cart.read-public',
  'cart.reconcile': 'cart.mutate',
  'cart.add': 'cart.mutate',
  'cart.remove': 'cart.mutate',
  'cart.set_quantity': 'cart.mutate',
  'checkout.prepare': 'checkout.prepare',
  'checkout.open': 'checkout.open',
  'navigation.go': 'navigation',
  'navigation.open': 'navigation',
} as const;
