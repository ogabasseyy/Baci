import { useLayoutEffect, useRef, useState } from 'react';
import {
  applyAddressField,
  applySelectedPlace,
  type DraftEdit,
} from '@/lib/order-gigl-address-draft';
import type {
  OrderGiglMissingField,
  OrderGiglReceiver,
  OrderGiglSelectedPlace,
} from '@/lib/order-gigl-shipping';
import {
  type OrderGiglInitialAddress,
  toOrderGiglAddressDraft,
} from '@/lib/order-gigl-shipping-state';

const DELIVERY_FIELDS: OrderGiglMissingField[] = [
  'address',
  'city',
  'state',
  'phone',
];

interface Props {
  initialAddress?: OrderGiglInitialAddress;
  orderId: string;
  preview: boolean;
  invalidateQuote: () => void;
}

export function useOrderGiglAddressEditor({
  initialAddress,
  orderId,
  preview,
  invalidateQuote,
}: Props) {
  const [addressDraft, setAddressDraft] = useState<Partial<OrderGiglReceiver>>(
    toOrderGiglAddressDraft(initialAddress)
  );
  const addressRef = useRef(addressDraft);
  const editingAddressRef = useRef(false);
  const scopeRef = useRef({ orderId, preview });
  const initialAddressRef = useRef(initialAddress);
  initialAddressRef.current = initialAddress;
  const [missingFields, setMissingFields] = useState<OrderGiglMissingField[]>(
    []
  );
  const reset = () => {
    editingAddressRef.current = false;
    addressRef.current = toOrderGiglAddressDraft(initialAddressRef.current);
    setAddressDraft(addressRef.current);
  };
  const begin = () => {
    // The form is prefilled. Clear the old rate so booking stays disabled until review and save.
    editingAddressRef.current = true;
    invalidateQuote();
    setMissingFields(DELIVERY_FIELDS);
  };
  const editDraft = (edit: DraftEdit) => {
    editingAddressRef.current = true;
    addressRef.current = edit(addressRef.current);
    setAddressDraft(addressRef.current);
    invalidateQuote();
  };
  const updateAddressField = (field: OrderGiglMissingField, value: string) =>
    editDraft((draft) => applyAddressField(draft, field, value));
  const selectAddressPlace = (place: OrderGiglSelectedPlace) =>
    editDraft((draft) => applySelectedPlace(draft, place));
  // biome-ignore lint/correctness/useExhaustiveDependencies: scalar address deps
  useLayoutEffect(() => {
    const scope = scopeRef.current;
    if (
      editingAddressRef.current &&
      scope.orderId === orderId &&
      scope.preview === preview
    )
      return;
    scopeRef.current = { orderId, preview };
    reset();
  }, [
    initialAddress?.address,
    initialAddress?.city,
    initialAddress?.latitude,
    initialAddress?.longitude,
    initialAddress?.phone,
    initialAddress?.state,
    preview,
    orderId,
  ]);
  return {
    addressDraft,
    addressRef,
    begin,
    editingAddressRef,
    missingFields,
    reset,
    selectAddressPlace,
    setMissingFields,
    updateAddressField,
  };
}
