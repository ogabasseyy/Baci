import type {
  BridgeResult,
  ExperienceCapability,
  ExperienceCommerce,
  PublicCart,
  PublicCartCommand,
  PublicCatalog,
  PublicProduct,
  SharedCartCommandPort,
} from '@baci/shared/experience';
import { experienceCartCommandSchema } from '@/schemas/experience-cart-command';
export function createExperienceCartAdapter(input: {
  commandPort: SharedCartCommandPort | undefined;
  operationId?: () => string;
  readPublicCart: () => Promise<BridgeResult<PublicCart>>;
  capabilities: ExperienceCapability[];
  catalog: () => PublicCatalog;
  resolveProduct?: (id: string) => Promise<PublicProduct | null>;
}): ExperienceCommerce['cart'] {
  const error = (
    code: 'CART_ENROLLMENT_REQUIRED' | 'INSUFFICIENT_SCOPE' | 'INVALID_REQUEST'
  ) => ({
    status: 'error' as const,
    code,
    message: 'Continue in the trusted storefront.',
  });
  const submit = async (raw: PublicCartCommand) => {
    if (!input.commandPort) return error('CART_ENROLLMENT_REQUIRED');
    if (!input.capabilities.includes('cart.mutate'))
      return error('INSUFFICIENT_SCOPE');
    const parsed = experienceCartCommandSchema.safeParse(raw);
    if (!parsed.success) return error('INVALID_REQUEST');
    const c = parsed.data;
    if (c.kind === 'add') {
      let p: PublicProduct | null | undefined;
      try {
        p = input.resolveProduct
          ? await input.resolveProduct(c.productId)
          : input.catalog().products.find((p) => p.id === c.productId);
      } catch {
        return error('INVALID_REQUEST');
      }
      if (
        !p ||
        p.available === false ||
        (p.requiresVariant && !c.variantId) ||
        (c.variantId &&
          !p.variants.some((v) => v.id === c.variantId && v.available))
      )
        return error('INVALID_REQUEST');
    }
    return await input.commandPort.submit(
      c,
      input.operationId?.() ?? crypto.randomUUID()
    );
  };
  return {
    reconcile: (operationId) => {
      if (!input.commandPort)
        return Promise.resolve(error('CART_ENROLLMENT_REQUIRED'));
      if (!input.capabilities.includes('cart.mutate'))
        return Promise.resolve(error('INSUFFICIENT_SCOPE'));
      if (
        typeof operationId !== 'string' ||
        !operationId.length ||
        operationId.length > 100
      )
        return Promise.resolve(error('INVALID_REQUEST'));
      return input.commandPort.reconcile(operationId);
    },
    readPublic: () =>
      input.capabilities.includes('cart.read-public')
        ? input.readPublicCart()
        : Promise.resolve(error('INSUFFICIENT_SCOPE')),
    add: (value) => submit({ kind: 'add', ...value }),
    remove: (lineId) => submit({ kind: 'remove', lineId }),
    setQuantity: (lineId, quantity) =>
      submit({ kind: 'set_quantity', lineId, quantity }),
  };
}
