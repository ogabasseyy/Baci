export type StartRepairPickupPaymentResult =
  | {
      success: true;
      id: string;
      ticketNumber: number;
      resumeToken: string;
      payment: {
        amount: number;
        authorizationUrl: string;
        reference: string;
      };
    }
  | {
      success: false;
      code: string;
      error: string;
      id?: string;
      ticketNumber?: number;
      resumeToken?: string;
      reference?: string;
      amountKobo?: number;
      currency?: string;
      quote?: { formattedPrice: string; price: number };
    };

export interface StartRepairPickupPaymentInput {
  data: unknown;
  expectedPickupFee: unknown;
  merchantId: string;
  merchantIdentifier: string;
  resumeToken?: string | null;
  onPaymentInitializationCheckpoint?: (
    result: StartRepairPickupPaymentResult
  ) => Promise<void>;
  /**
   * Runs immediately before the Paystack initialization request, after the
   * merchant lookup, quote, repair setup, and reference binding. Receipt
   * owners use it to fence execution (claim the receipt) at the latest safe
   * moment so a crash earlier stays reclaimable; the completion writes
   * require fencing to have happened.
   */
  onBeforeProviderInitialization?: () => Promise<void>;
}
