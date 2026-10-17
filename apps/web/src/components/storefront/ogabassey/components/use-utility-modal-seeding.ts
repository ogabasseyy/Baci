import { useState, type Dispatch, type SetStateAction } from 'react';
import type { UtilityTabId } from './UtilityTabs';
import type { UtilityPendingIntent } from './use-utility-pending-intent';
import type { UtilityPurchaseStep } from './use-utility-purchase';

/**
 * Seeds the modal form from the owned resume draft. Render-time
 * prev-prop comparison: `prevIsOpen` inits `false` so the seed also
 * runs when the modal renders already-open. A customer change
 * (auth hydration undefined -> defined, or an account switch
 * defined -> defined on the same shared tab) re-seeds from the NEW
 * customer's owned intent — a keystroke does NOT change
 * `customer.id`, so reseeds never remount mid-typing (which would
 * drop input focus). Returns the applied intent key for the form
 * remount key. Extracted from UtilityModal per the Boy Scout Rule.
 */
export function useUtilityModalFormSeeding({
  closeFundingPanel,
  customerChanged,
  initialTab,
  intent,
  isOpen,
  setActiveTab,
  setStep,
}: {
  closeFundingPanel: () => void;
  customerChanged: boolean;
  initialTab: UtilityTabId;
  intent: UtilityPendingIntent | null;
  isOpen: boolean;
  setActiveTab: (tab: UtilityTabId) => void;
  setStep: Dispatch<SetStateAction<UtilityPurchaseStep>>;
}): { appliedIntentKey: string | null } {
  // Stable identity of the owned resume draft; null when nothing to resume.
  const intentKey = intent
    ? `${intent.tab}|${intent.amount}|${intent.phoneNumber}|${intent.networkProvider ?? ''}`
    : null;

  const [prevIsOpen, setPrevIsOpen] = useState(false);
  const [prevInitialTab, setPrevInitialTab] = useState(initialTab);
  // Owned intent already applied to the form; also part of the form remount key.
  const [appliedIntentKey, setAppliedIntentKey] = useState<string | null>(null);
  if (isOpen !== prevIsOpen || initialTab !== prevInitialTab) {
    setPrevIsOpen(isOpen);
    setPrevInitialTab(initialTab);
    if (isOpen) {
      // Land on the tab holding the resumed draft so a `data` draft is not
      // stranded on the default `airtime` tab. `intentKey` may be null until
      // auth hydrates — the customer-change branch below reseeds then.
      setActiveTab(intent?.tab ?? initialTab);
      setStep('details');
      // Collapse the funding panel so reopening never re-triggers DVA
      // auto-create without a fresh "Pay with Bank Transfer" tap.
      closeFundingPanel();
      setAppliedIntentKey(intentKey);
    } else {
      // Re-arm seeding for the next open.
      setAppliedIntentKey(null);
    }
  } else if (isOpen && customerChanged) {
    // Signed-in customer changed while the modal stayed open (auth hydrating,
    // or an account switch). Re-seed for them and remount AirtimeDataForm (its
    // key includes `customerId`): the previous customer's typed phone/amount
    // lives in the form's LOCAL state — which no prop clears without a remount
    // — and must never surface to the next customer.
    setActiveTab(intent?.tab ?? initialTab);
    setStep('details');
    setAppliedIntentKey(intentKey);
  }

  return { appliedIntentKey };
}
