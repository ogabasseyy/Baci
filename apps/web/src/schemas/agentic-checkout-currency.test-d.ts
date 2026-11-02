import { expectTypeOf } from 'vitest';
import type { z } from 'zod';
import { checkoutSessionSchema } from './agentic-checkout';

declare const session: z.output<typeof checkoutSessionSchema>;
expectTypeOf(session.currency).toEqualTypeOf<string>();
const parsed = checkoutSessionSchema.safeParse({});
if (parsed.success && !('cart_id' in parsed.data)) {
  expectTypeOf(parsed.data.currency).toEqualTypeOf<string>();
}
