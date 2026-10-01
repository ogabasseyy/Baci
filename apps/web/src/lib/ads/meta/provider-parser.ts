import { z } from 'zod';
import { MetaAdsProviderError } from './provider-http';
import type { MetaActionValue, MetaAdsDailyInsight } from './provider-types';

const DECIMAL = /^\d+(?:\.\d+)?$/;
const INTEGER = /^\d+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface MetaAdsAccount {
  accountId: string;
  currencyCode: string;
  label: string;
  timezoneName: string;
  timezoneOffsetHours: string | null;
}

const accountSchema = z.object({
  account_id: z.string().regex(/^\d+$/).optional(),
  account_status: z.union([z.number(), z.string()]).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  id: z.string().regex(/^act_\d+$/),
  name: z.string().min(1),
  timezone_name: z.string().min(1),
  timezone_offset_hours_utc: z.union([z.number(), z.string()]).optional(),
});

export function parseMetaAdsAccount(value: unknown): MetaAdsAccount | null {
  const parsed = accountSchema.safeParse(value);
  if (!parsed.success || Number(parsed.data.account_status) !== 1) return null;
  return {
    accountId: parsed.data.id,
    currencyCode: parsed.data.currency,
    label: parsed.data.name,
    timezoneName: parsed.data.timezone_name,
    timezoneOffsetHours:
      parsed.data.timezone_offset_hours_utc === undefined
        ? null
        : String(parsed.data.timezone_offset_hours_utc),
  };
}

function parseActions(value: unknown): MetaActionValue[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const actions: MetaActionValue[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      return null;
    const actionType = (entry as { action_type?: unknown }).action_type;
    const actionValue = (entry as { value?: unknown }).value;
    if (
      typeof actionType !== 'string' ||
      !actionType ||
      typeof actionValue !== 'string' ||
      !DECIMAL.test(actionValue)
    )
      return null;
    actions.push({ actionType, value: actionValue });
  }
  return actions;
}

function readNonNegativeInteger(value: unknown): string | null {
  const valueString = typeof value === 'number' ? String(value) : value;
  return typeof valueString === 'string' && INTEGER.test(valueString)
    ? valueString
    : null;
}

export function parseMetaAdsDailyInsights(
  payload: unknown,
  accountId: string
): MetaAdsDailyInsight[] {
  if (!/^act_\d+$/.test(accountId)) return [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new MetaAdsProviderError('META_ADS_INSIGHTS_RESPONSE_INVALID');
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data))
    throw new MetaAdsProviderError('META_ADS_INSIGHTS_RESPONSE_INVALID');
  const insights: MetaAdsDailyInsight[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new MetaAdsProviderError('META_ADS_INSIGHTS_ROW_INVALID');
    const row = item as Record<string, unknown>;
    const spend = row.spend;
    const impressions = readNonNegativeInteger(row.impressions);
    const clicks = readNonNegativeInteger(row.clicks);
    const dateStart = row.date_start;
    const dateStop = row.date_stop;
    if (
      typeof spend !== 'string' ||
      !DECIMAL.test(spend) ||
      !impressions ||
      !clicks ||
      typeof dateStart !== 'string' ||
      !ISO_DATE.test(dateStart) ||
      typeof dateStop !== 'string' ||
      !ISO_DATE.test(dateStop) ||
      dateStart !== dateStop
    )
      throw new MetaAdsProviderError('META_ADS_INSIGHTS_ROW_INVALID');
    if (
      row.account_id !== undefined &&
      (typeof row.account_id !== 'string' || !/^\d+$/.test(row.account_id))
    )
      throw new MetaAdsProviderError('META_ADS_INSIGHTS_ROW_INVALID');
    const providerAccountId =
      typeof row.account_id === 'string' ? `act_${row.account_id}` : accountId;
    if (providerAccountId !== accountId)
      throw new MetaAdsProviderError('META_ADS_INSIGHTS_ROW_INVALID');
    const reach = readNonNegativeInteger(row.reach);
    if (row.reach !== undefined && reach === null)
      throw new MetaAdsProviderError('META_ADS_INSIGHTS_ROW_INVALID');
    const actions = parseActions(row.actions);
    const actionValues = parseActions(row.action_values);
    if (!actions || !actionValues)
      throw new MetaAdsProviderError('META_ADS_INSIGHTS_ROW_INVALID');
    if (
      row.attribution_setting !== undefined &&
      row.attribution_setting !== null &&
      typeof row.attribution_setting !== 'string'
    )
      throw new MetaAdsProviderError('META_ADS_INSIGHTS_ROW_INVALID');
    insights.push({
      accountId,
      actions,
      actionValues,
      attributionSetting:
        typeof row.attribution_setting === 'string'
          ? row.attribution_setting
          : null,
      clicks,
      dateStart,
      dateStop,
      impressions,
      reach,
      spendAmountDecimal: spend,
    });
  }
  return insights;
}
