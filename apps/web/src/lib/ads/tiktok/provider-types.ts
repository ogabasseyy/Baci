export interface TikTokAdsAccount {
  accountId: string;
  currencyCode: string;
  label: string;
  timezoneName: string;
}

export interface TikTokAdsDailyReport {
  accountId: string;
  clicks: string;
  conversions: string;
  currencyCode: string;
  impressions: string;
  reach: string | null;
  spendAmountDecimal: string;
  spendDate: string;
  timezoneName: string;
}

export type TikTokAdsAsyncTaskStatus =
  | 'QUEUING'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'FAILED'
  | 'CANCELED';
