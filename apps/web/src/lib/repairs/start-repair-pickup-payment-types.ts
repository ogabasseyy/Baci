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
  onPaymentInitializationStarted?: (
    result: StartRepairPickupPaymentResult
  ) => Promise<void>;
}
