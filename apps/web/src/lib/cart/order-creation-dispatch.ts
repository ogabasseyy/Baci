import type { NextResponse } from 'next/server';
import type { OrderCreateInput } from '@/schemas/orders';
import type {
  SubmitCartBoundOrderDeps,
  SubmitCartBoundOrderInput,
} from './order-binding';
import { submitSharedCartOrderBinding } from './order-route-binding';

type OrderCartBinding = OrderCreateInput['shared_cart'];

/**
 * Bound-order dispatch and response mapping: shared-cart checkouts run
 * through the binding RPC (which closes the reviewed cart generation
 * atomically), legacy checkouts call the variant RPC directly. Binding
 * failures return early; inner order rejections keep their message and
 * code shape so the route's existing error mapper handles them.
 */
export async function dispatchOrderCreation(input: {
  args: Record<string, unknown>;
  binding: OrderCartBinding;
  client: SubmitCartBoundOrderDeps['client'];
  principalId: string | null;
  rpcName: string;
  variant: SubmitCartBoundOrderInput['variant'];
}): Promise<{
  failure: NextResponse | null;
  orderRows: unknown;
  orderError: { code?: unknown; message?: unknown } | null;
}> {
  const { bound, failure: bindingFailure } = await submitSharedCartOrderBinding(
    { client: input.client },
    {
      args: input.args,
      binding: input.binding,
      principalId: input.principalId,
      variant: input.variant,
    }
  );
  if (bindingFailure) {
    return { failure: bindingFailure, orderRows: null, orderError: null };
  }
  if (bound) {
    return {
      failure: null,
      orderRows: bound.ok ? bound.order : null,
      orderError: bound.ok
        ? null
        : {
            code: bound.code === 'order_rejected' ? 'P0001' : 'XX000',
            message: bound.message,
          },
    };
  }
  const { data, error } = await input.client.rpc(input.rpcName, input.args);
  return { failure: null, orderRows: data, orderError: error };
}
