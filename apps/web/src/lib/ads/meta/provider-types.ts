export interface MetaActionValue {
  actionType: string;
  value: string;
}

export interface MetaAdsDailyInsight {
  accountId: string;
  actions: MetaActionValue[];
  actionValues: MetaActionValue[];
  attributionSetting: string | null;
  clicks: string;
  dateStart: string;
  dateStop: string;
  impressions: string;
  reach: string | null;
  spendAmountDecimal: string;
}
