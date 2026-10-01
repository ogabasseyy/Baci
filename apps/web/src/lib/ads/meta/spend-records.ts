import 'server-only';

import { META_ADS_CONVERSION_ACTION_ALLOWLIST_VERSION } from './constants';
import { countMetaAdsConversions } from './conversion-count';
import type {
  MetaAdsAccount,
  MetaAdsDailyInsight,
  MetaAdsUsageTelemetry,
} from './provider';

export interface MetaAdsSpendRecord {
  account_timezone: string;
  attribution_metadata: {
    actionValues: MetaAdsDailyInsight['actionValues'];
    actions: MetaAdsDailyInsight['actions'];
    attributionSetting: string | null;
    provider: 'meta_ads';
    providerAttributedConversionAllowlistVersion: string;
    providerDateStart: string;
    providerDateStop: string;
    providerTimezoneOffsetHours: string | null;
    providerVersion: 'v25.0';
    usageTelemetry: MetaAdsUsageTelemetry | null;
  };
  clicks: string;
  conversions: string;
  currency_code: string;
  fetched_at: string;
  impressions: string;
  provider_customer_id: string;
  reach: string | null;
  spend_micros: '0';
  spend_amount_decimal: string;
  spend_date: string;
}

export function buildMetaAdsSpendRecords(input: {
  account: MetaAdsAccount;
  fetchedAt: string;
  insights: readonly MetaAdsDailyInsight[];
  usageTelemetry: MetaAdsUsageTelemetry | null;
}): MetaAdsSpendRecord[] {
  return input.insights.map((insight) => ({
    account_timezone: input.account.timezoneName,
    attribution_metadata: {
      actionValues: insight.actionValues,
      actions: insight.actions,
      attributionSetting: insight.attributionSetting,
      provider: 'meta_ads',
      providerAttributedConversionAllowlistVersion:
        META_ADS_CONVERSION_ACTION_ALLOWLIST_VERSION,
      providerDateStart: insight.dateStart,
      providerDateStop: insight.dateStop,
      providerTimezoneOffsetHours: input.account.timezoneOffsetHours,
      providerVersion: 'v25.0',
      usageTelemetry: input.usageTelemetry,
    },
    clicks: insight.clicks,
    conversions: countMetaAdsConversions(insight.actions),
    currency_code: input.account.currencyCode,
    fetched_at: input.fetchedAt,
    impressions: insight.impressions,
    provider_customer_id: insight.accountId,
    reach: insight.reach,
    spend_micros: '0',
    spend_amount_decimal: insight.spendAmountDecimal,
    spend_date: insight.dateStart,
  }));
}
