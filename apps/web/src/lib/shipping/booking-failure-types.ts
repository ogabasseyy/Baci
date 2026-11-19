export type BookingFailureOutcome =
  | 'not_submitted'
  | 'provider_unconfirmed'
  | 'rejected'
  | 'booked_not_saved'
  // Booked and saved, but the wallet charge could not be completed.
  | 'booked_unreconciled'
  | 'unexpected';

export type ClassifiedBookingFailure = {
  code: string;
  message: string;
  httpStatus: number | null;
  outcome: BookingFailureOutcome;
  /** Carrier reference when the carrier already booked the parcel. */
  providerReference?: string;
};
