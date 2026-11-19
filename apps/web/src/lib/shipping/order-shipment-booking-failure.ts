// Compatibility barrel: each responsibility lives in its own module.
export {
  BOOKED_SHIPMENT_NOT_SAVED_CODE,
  GIGL_BOOKING_TIMEOUT_MESSAGE,
  GIGL_INTERNATIONAL_BOOKING_TIMEOUT_MESSAGE,
} from './booking-failure-constants';
export type {
  BookingFailureOutcome,
  ClassifiedBookingFailure,
} from './booking-failure-types';
export { classifyBookingFailure } from './classify-booking-failure';
export { ProviderBookingTimeoutError } from './provider-booking-timeout-error';
export {
  isProviderNeverReachedError,
  tagProviderCallError,
} from './provider-never-reached';
export { recordOrderShipmentBookingFailure } from './record-order-shipment-booking-failure';
export { toBookingFailureResponseError } from './to-booking-failure-response-error';
