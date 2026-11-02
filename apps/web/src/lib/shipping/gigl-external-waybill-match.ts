import type { GiglPreShipment } from './providers/gigl.schemas';

export interface ExternalWaybillOrderReceiver {
  customer_name: string | null;
  customer_phone: string | null;
  shipping_address: {
    city?: string | null;
    phone?: string | null;
    state?: string | null;
  } | null;
}

export type ExternalWaybillFieldMatch = 'match' | 'mismatch' | 'unknown';

export interface ExternalWaybillMatch {
  name: ExternalWaybillFieldMatch;
  phone: ExternalWaybillFieldMatch;
  destination: ExternalWaybillFieldMatch;
  /** The receiver is the order's customer and the destination agrees. */
  linkable: boolean;
}

// GIG writes the Federal Capital Territory several ways.
const STATE_ALIASES: Record<string, string> = {
  abuja: 'fct',
  'abuja fct': 'fct',
  'federal capital territory': 'fct',
  fct: 'fct',
  'fct abuja': 'fct',
};

function nameTokens(value: string | null | undefined): string[] {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function nationalPhoneDigits(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  // Compare the last ten digits so +234 803…, 234803… and 0803… agree.
  return digits.length >= 10 ? digits.slice(-10) : null;
}

function normalizeState(value: string | null | undefined): string | null {
  const normalized = (value ?? '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\bstate\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;
  return STATE_ALIASES[normalized] ?? normalized;
}

function compareNames(
  orderName: string | null,
  receiverName: string | undefined
): ExternalWaybillFieldMatch {
  const orderTokens = new Set(nameTokens(orderName));
  const receiverTokens = new Set(nameTokens(receiverName));
  if (orderTokens.size === 0 || receiverTokens.size === 0) return 'unknown';
  // Every word of the shorter name must appear in the longer one, so
  // "Emmanuel Audu" matches "Audu Emmanuel" but a shared first name alone
  // ("Emmanuel Okafor") does not.
  const [shorter, longer] =
    orderTokens.size <= receiverTokens.size
      ? [orderTokens, receiverTokens]
      : [receiverTokens, orderTokens];
  return [...shorter].every((token) => longer.has(token))
    ? 'match'
    : 'mismatch';
}

function comparePhones(
  orderPhones: Array<string | null | undefined>,
  receiverPhone: string | undefined
): ExternalWaybillFieldMatch {
  const receiverDigits = nationalPhoneDigits(receiverPhone);
  const orderDigits = orderPhones
    .map(nationalPhoneDigits)
    .filter((digits): digits is string => digits !== null);
  if (!receiverDigits || orderDigits.length === 0) return 'unknown';
  return orderDigits.includes(receiverDigits) ? 'match' : 'mismatch';
}

function compareDestinations(
  orderState: string | null | undefined,
  receiverState: string | undefined
): ExternalWaybillFieldMatch {
  const order = normalizeState(orderState);
  const receiver = normalizeState(receiverState);
  if (!order || !receiver) return 'unknown';
  return order === receiver ? 'match' : 'mismatch';
}

/**
 * Compares the receiver on a GIG waybill with the Baci order it is about to
 * be attached to. A waybill is linkable only when the receiver's phone is
 * the order's and the destination state agrees (or the order has no state).
 */
export function matchExternalWaybillToOrder(
  order: ExternalWaybillOrderReceiver,
  preShipment: Pick<
    GiglPreShipment,
    'ReceiverName' | 'ReceiverPhoneNumber' | 'ReceiverState'
  >
): ExternalWaybillMatch {
  const name = compareNames(order.customer_name, preShipment.ReceiverName);
  const phone = comparePhones(
    [order.shipping_address?.phone, order.customer_phone],
    preShipment.ReceiverPhoneNumber
  );
  const destination = compareDestinations(
    order.shipping_address?.state,
    preShipment.ReceiverState
  );
  // Every merchant books through one shared GIG account, so a matching
  // phone is required: a name and state alone could fit another merchant's
  // customer. The name is reported for staff but never decides on its own.
  const receiverMatches = phone === 'match';
  // In-store orders often carry no delivery state; a matching phone number
  // is then the evidence that the parcel is this customer's. A GIG response
  // without a destination never skips the check for an order that has one.
  const orderHasState = normalizeState(order.shipping_address?.state) !== null;
  const destinationAgrees =
    destination === 'match' || (!orderHasState && phone === 'match');

  return {
    name,
    phone,
    destination,
    linkable: receiverMatches && destinationAgrees,
  };
}
