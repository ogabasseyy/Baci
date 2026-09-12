import { type RefObject, useEffect, useRef } from 'react';
import {
  type AdminTabScrollTarget,
  registerAdminTabScrollTarget,
} from '@/lib/admin-tab-scroll-to-top';

export function useAdminTabScrollToTop<T extends AdminTabScrollTarget>(
  routeName: string,
  externalRef?: RefObject<T | null>
) {
  const ownedRef = useRef<T>(null);
  const scrollRef = externalRef ?? ownedRef;
  useEffect(
    () => registerAdminTabScrollTarget(routeName, () => scrollRef.current),
    [routeName, scrollRef]
  );
  return scrollRef;
}
