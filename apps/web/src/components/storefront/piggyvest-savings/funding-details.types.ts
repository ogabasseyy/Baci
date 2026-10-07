export type FundingDetailsProps =
  | { status: 'loading' | 'pending' | 'unavailable' }
  | {
      status: 'ready';
      accounts: Array<{
        accountNumber: string;
        accountName: string;
        bankName: string;
      }>;
    };
