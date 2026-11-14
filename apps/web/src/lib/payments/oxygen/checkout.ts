export type OxygenHostedStep = 'payment' | 'setup';
export interface OxygenCheckoutQuote {
  productMinor: number;
  equityPercentage: number;
  equityMinor: number;
  principalMinor: number;
  chargesMinor: number;
  upfrontMinor: number;
  totalRepaymentMinor: number;
  interestMinor: number;
  managementMinor: number;
  insuranceMinor: number;
  vatMinor: number;
  tenureMonths: number;
  instalmentsMinor: number[];
}
export interface OxygenCheckoutSnapshot {
  mode: 'simulation';
  bookingReference: string;
  phase: 'booked' | 'approved' | 'simulation_complete';
  quote: OxygenCheckoutQuote;
  paymentComplete: boolean;
  setupComplete: boolean;
  realActivation: 'not_requested';
  settlement: 'not_verified';
}
/** Simulation-only boundary. There is deliberately no real activate/pay API. */
export interface OxygenCheckoutAdapter {
  readonly mode: 'simulation';
  load(): Promise<OxygenCheckoutSnapshot>;
  acceptOffer(reference: string): Promise<OxygenCheckoutSnapshot>;
  replaceBooking(
    reference: string,
    equityPercentage: number
  ): Promise<OxygenCheckoutSnapshot>;
  checkCompletion(reference: string): Promise<OxygenCheckoutSnapshot>;
  simulateHostedCompletion(
    reference: string,
    step: OxygenHostedStep
  ): Promise<OxygenCheckoutSnapshot>;
  confirmPreview(reference: string): Promise<OxygenCheckoutSnapshot>;
}
