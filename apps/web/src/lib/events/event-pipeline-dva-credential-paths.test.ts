import { describe, expect, it } from 'vitest';
import { eventPipelineDvaCredentialPaths } from './event-pipeline-dva-credential-paths';

describe('DVA reservation credential paths', () => {
  it('pins every provisioning entrypoint to the persist/reserve helpers', () => {
    expect(eventPipelineDvaCredentialPaths).toEqual([
      [
        'apps/web/src/lib/payments/persist-paystack-dva-assignment.ts',
        'apps/web/src/lib/payments/reserve-paystack-dva-assignment.ts',
        'apps/web/src/env.ts',
      ],
      [
        'apps/web/src/lib/payments/reserve-paystack-dva-assignment.ts',
        'apps/web/src/env.ts',
      ],
      [
        'apps/web/src/app/api/orders/[id]/generate-dva/route.ts',
        'apps/web/src/lib/payments/reserve-paystack-dva-assignment.ts',
        'apps/web/src/env.ts',
      ],
      [
        'apps/web/src/app/api/orders/[id]/generate-dva/generate-dva-test-support.ts',
        'apps/web/src/app/api/orders/[id]/generate-dva/route.ts',
        'apps/web/src/lib/payments/reserve-paystack-dva-assignment.ts',
        'apps/web/src/env.ts',
      ],
      [
        'apps/web/src/app/api/orders/[id]/ship-on-credit/provision-credit-order-dva.ts',
        'apps/web/src/lib/payments/persist-paystack-dva-assignment.ts',
        'apps/web/src/lib/payments/reserve-paystack-dva-assignment.ts',
        'apps/web/src/env.ts',
      ],
      [
        'apps/web/src/app/api/orders/[id]/ship-on-credit/route.ts',
        'apps/web/src/app/api/orders/[id]/ship-on-credit/provision-credit-order-dva.ts',
        'apps/web/src/lib/payments/persist-paystack-dva-assignment.ts',
        'apps/web/src/lib/payments/reserve-paystack-dva-assignment.ts',
        'apps/web/src/env.ts',
      ],
      [
        'apps/web/src/app/api/orders/route.ts',
        'apps/web/src/lib/payments/persist-paystack-dva-assignment.ts',
        'apps/web/src/lib/payments/reserve-paystack-dva-assignment.ts',
        'apps/web/src/env.ts',
      ],
      [
        'apps/web/src/app/api/payments/initialize/route.ts',
        'apps/web/src/lib/payments/persist-paystack-dva-assignment.ts',
        'apps/web/src/lib/payments/reserve-paystack-dva-assignment.ts',
        'apps/web/src/env.ts',
      ],
    ]);
  });
});
