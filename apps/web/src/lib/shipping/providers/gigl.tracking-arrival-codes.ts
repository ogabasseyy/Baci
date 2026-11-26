// GIG scan-code sets the lifecycle guards use to classify arrival, departure and
// return scans (see gigl.tracking-lifecycle-guards.ts).
// Intentionally narrow: other in_transit scans at a destination-named centre
// count as arriving. Missing an arrival beats a false one, so extend with care.
export const DEPARTURE_CODES = new Set([
  'DSC',
  'DPC',
  'DCC',
  'DST',
  'DTR',
  'DIWN',
  // GIG's "SHIPMENT DEPARTS SERVICE CENTRE" (code-only scans carry no reason).
  'MDSE',
  // Departures from the UK and US (international origin offices).
  'IDK',
  'IDH',
]);

// Return-flow and exception scans (damage, claims) can occur at the destination
// centre after a failed delivery; they are not an arrival.
export const RETURN_CODES = new Set([
  'SRC',
  'RSR',
  'MRTE',
  'SSR',
  'MRTD',
  'DASH',
  'CLS',
  // Delay, customs and transfer scans are not arrivals either.
  'DLD',
  'CLC',
  'UCC',
  'GOP',
  'TRO',
  'SRIC',
]);
// Scans that start the return flow back to the sender: once seen, a later
// arrival scan is the parcel reaching the sender, not the customer's city.
// RSR: returned shipment received by Operations (GIG's scan-status list).
// MRTD is "shipment rerouted" (ordinary transit), so it is not a return signal.
// SRHUB: the return completed at the sender's hub (a later arrival scan is the
// parcel reaching the sender, not the customer's city).
export const RETURN_FLOW_CODES = new Set([
  'SRC',
  'MRTE',
  'SSR',
  'RSR',
  'SRHUB',
]);
// Explicit "arrived final destination" scans, so no destination name match is
// needed. Source: GIG's "Scan Status List" (checked 2026-11-26) at
// https://gig-logistics.readme.io/reference/get_track-mobileshipment
// ARF/ARF* and IAFD* read "arrived final destination", AHD "... for home
// delivery", ADF "arrived delivery facility", AD "from 2nd day of arrival at
// destination", DUBC "delayed pick up by customer". MAFD is not on that list;
// the shared status map carries it.
export const EXPLICIT_ARRIVAL_CODES = new Set([
  'ARF',
  'MAFD',
  'AHD',
  'ADF',
  'ARFTPKU',
  // International final-destination arrivals (terminal pickup, home delivery).
  'IAFDSC',
  'IAFDHD',
  'ARFGH',
  'ARFFSTP',
  'ARFFSHD',
  'ARFGFR',
  'ARFGFS',
  // Daily / delayed-pickup scans only occur after reaching the destination.
  'AD',
  'DUBC',
]);

// Foreign-office arrivals only count when the shipment is headed to that
// office's country; for a Nigeria-bound parcel they are the origin leg.
export const FOREIGN_OFFICE_DESTINATIONS: Record<string, RegExp> = {
  ARFK: /\b(UK|U\.K|UNITED KINGDOM|ENGLAND|LONDON)\b/,
  ARFP: /\b(UK|U\.K|UNITED KINGDOM|ENGLAND|LONDON)\b/,
  ARFH: /\b(US|USA|UNITED STATES|HOUSTON|TEXAS)\b/,
  ARUS: /\b(US|USA|UNITED STATES|HOUSTON|TEXAS)\b/,
};

// Whole word only, so unrelated text that merely contains DEPART (e.g.
// DEPARTMENT) cannot suppress an arrival.
export const DEPARTURE_WORD = /\bDEPART(?:S|ED|ING|URES?)?\b/i;
