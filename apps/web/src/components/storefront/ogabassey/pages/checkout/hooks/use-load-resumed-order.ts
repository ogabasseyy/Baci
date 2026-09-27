import { useEffect, useEffectEvent } from 'react';
import {
  type LoadResumedCheckoutOrderParams,
  loadResumedCheckoutOrder,
} from '../load-resumed-checkout-order';

type RequestFields = Pick<
  LoadResumedCheckoutOrderParams,
  'resumeTrackingToken' | 'resumeLookupEmail' | 'preferredGateway'
> & {
  resumeOrderId: string | null;
  resumeMerchantSlug: string | null;
};
type Callbacks = Omit<
  LoadResumedCheckoutOrderParams,
  keyof RequestFields | 'signal'
>;

/** Only a change to order identity starts another load. Hydrating the form
 * must not re-fetch merely because its persisted-state setter was recreated. */
export function useLoadResumedOrder({
  resumeOrderId,
  resumeMerchantSlug,
  resumeTrackingToken,
  resumeLookupEmail,
  preferredGateway,
  ...callbacks
}: RequestFields & Callbacks) {
  const onLoad = useEffectEvent(
    (request: Omit<LoadResumedCheckoutOrderParams, keyof Callbacks>) =>
      loadResumedCheckoutOrder({ ...callbacks, ...request })
  );
  const onReset = useEffectEvent(() => {
    callbacks.setIsLoadingResumedOrder(false);
    callbacks.setResumedOrder(null);
    callbacks.setResumeOrderError(null);
  });
  useEffect(() => {
    if (!resumeOrderId || !resumeMerchantSlug) {
      onReset();
      return;
    }
    const controller = new AbortController();
    void onLoad({
      resumeOrderId,
      resumeMerchantSlug,
      resumeTrackingToken,
      resumeLookupEmail,
      preferredGateway,
      signal: controller.signal,
    });
    return () => controller.abort();
  }, [
    resumeOrderId,
    resumeMerchantSlug,
    resumeTrackingToken,
    resumeLookupEmail,
    preferredGateway,
  ]);
}
