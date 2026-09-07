import { useRef, useState } from 'react';
import { usePersistedForm } from '@/hooks/use-persisted-state';

// Page tests inject contact fixtures through usePersistedForm. Keep its spy
// calls while modelling real field updates for delivery/consent interactions.
export function useCheckoutFormTestState() {
  const form = usePersistedForm<Record<string, unknown>>('checkout-form', {});
  const [updates, setUpdates] = useState<Record<string, unknown>>({});
  const formRef = useRef(form);
  formRef.current = form;
  const [actions] = useState(() => ({
    setValue: (field: string, value: unknown) => {
      formRef.current.setValue(field, value);
      setUpdates((previous) => ({ ...previous, [field]: value }));
    },
    setValues: (values: Record<string, unknown>) => {
      formRef.current.setValues(values);
      setUpdates((previous) => ({ ...previous, ...values }));
    },
  }));
  return {
    ...form,
    ...actions,
    values: {
      deliveryCoordinates: null,
      deliveryMethod: 'door',
      newsletterOptIn: false,
      ...form.values,
      ...updates,
    },
  };
}
