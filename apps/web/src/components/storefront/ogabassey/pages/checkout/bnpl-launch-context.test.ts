import { describe, expectTypeOf, it } from 'vitest';
import type {
  BnplLaunchControls,
  BnplLaunchOrderContext,
  BnplLaunchStatus,
} from './bnpl-launch-context';

describe('bnpl-launch-context shapes', () => {
  it('pins the launcher status union', () => {
    expectTypeOf<BnplLaunchStatus>().toEqualTypeOf<
      'loading' | 'processing' | 'error'
    >();
  });

  it('requires order and identity fields on the attempt context', () => {
    expectTypeOf<BnplLaunchOrderContext>().toMatchTypeOf<{
      order: unknown;
      slug: string;
      trackingToken: string | null;
    }>();
    expectTypeOf<BnplLaunchOrderContext>().toMatchTypeOf<BnplLaunchControls>();
  });
});
