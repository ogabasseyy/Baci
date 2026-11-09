import type {
  OrderGiglMissingField,
  OrderGiglReceiver,
  OrderGiglSelectedPlace,
} from './order-gigl-shipping';

type Draft = Partial<OrderGiglReceiver>;
export type DraftEdit = (draft: Draft) => Draft;

// Editing the street by hand invalidates a pin picked for the old address.
export function applyAddressField(
  draft: Draft,
  field: OrderGiglMissingField,
  value: string
): Draft {
  if (field !== 'address') return { ...draft, [field]: value };
  const { latitude: _lat, longitude: _lng, ...rest } = draft;
  return { ...rest, address: value };
}

// A picked place replaces address, city, state and pin together.
export function applySelectedPlace(
  draft: Draft,
  place: OrderGiglSelectedPlace
): Draft {
  return {
    ...draft,
    address: place.address,
    city: place.city,
    state: place.state,
    latitude: place.latitude,
    longitude: place.longitude,
  };
}
