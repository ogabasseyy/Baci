import {
  OGABASSEY_CHANGE_OF_MIND_BUYBACK,
  OGABASSEY_RETURN_SHIPPING,
} from '@baci/shared';
import { Truck } from 'lucide-react';

export function OgabasseyReturnShipping() {
  return (
    <section className="mt-6 space-y-3 rounded-2xl border border-store-border p-5">
      <h2 className="text-lg font-semibold">
        <Truck className="mr-2 inline-block" size={18} aria-hidden="true" />
        Return shipping and buybacks
      </h2>
      <p>{OGABASSEY_RETURN_SHIPPING}</p>
      <p>{OGABASSEY_CHANGE_OF_MIND_BUYBACK}</p>
    </section>
  );
}
