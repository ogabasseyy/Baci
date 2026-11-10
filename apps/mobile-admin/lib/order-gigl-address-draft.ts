import type {
  OrderGiglMissingField,
  OrderGiglReceiver,
  OrderGiglSelectedPlace,
} from './order-gigl-shipping';

const PIN_FIELDS: OrderGiglMissingField[] = ['address', 'city', 'state'];

type Draft = Partial<OrderGiglReceiver>;
export type DraftEdit = (draft: Draft) => Draft;

// Editing the street, city or state by hand invalidates the old pin.
export function applyAddressField(
  draft: Draft,
  field: OrderGiglMissingField,
  value: string
): Draft {
  if (!PIN_FIELDS.includes(field)) return { ...draft, [field]: value };
  const { latitude: _lat, longitude: _lng, ...rest } = draft;
  return { ...rest, [field]: value };
}

// A picked place replaces address, city, state and pin together.
export function applySelectedPlace(
  draft: Draft,
  place: OrderGiglSelectedPlace
): Draft {
  const { latitude: _lat, longitude: _lng, ...rest } = draft;
  const hasPin =
    Number.isFinite(place.latitude) &&
    Number.isFinite(place.longitude) &&
    Math.abs(place.latitude as number) <= 90 &&
    Math.abs(place.longitude as number) <= 180;
  return {
    ...rest,
    address: place.address,
    city: place.city,
    state: place.state,
    ...(hasPin ? { latitude: place.latitude, longitude: place.longitude } : {}),
  };
}
