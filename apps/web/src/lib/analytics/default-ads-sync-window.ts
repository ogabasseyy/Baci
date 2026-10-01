import { format, subDays } from 'date-fns';
import { ADS_SYNC_MAX_DAYS, type AdsSyncProvider } from './ads-sync-limits';

export interface AdsSyncWindow {
  endDate: string;
  startDate: string;
}

/** Formats the selected browser-local analytics dates for provider sync. */
export function buildAdsSyncWindow(start: Date, end: Date): AdsSyncWindow {
  return {
    endDate: format(end, 'yyyy-MM-dd'),
    startDate: format(start, 'yyyy-MM-dd'),
  };
}

function parseUtcDate(value: string): Date | null {
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

/**
 * Splits a valid inclusive date range into requests accepted by a provider.
 * Invalid input is returned unchanged so the provider schema remains the
 * final validation boundary rather than making a dashboard click throw.
 */
export function buildAdsSyncWindowChunks(
  window: AdsSyncWindow,
  provider: AdsSyncProvider
): AdsSyncWindow[] {
  const start = parseUtcDate(window.startDate);
  const end = parseUtcDate(window.endDate);
  const maxDays = ADS_SYNC_MAX_DAYS[provider];
  if (!start || !end || start > end) return [window];

  const chunks: AdsSyncWindow[] = [];
  let cursor = start;
  while (cursor <= end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + maxDays - 1);
    const boundedEnd = chunkEnd < end ? chunkEnd : end;
    chunks.push({
      endDate: boundedEnd.toISOString().slice(0, 10),
      startDate: cursor.toISOString().slice(0, 10),
    });
    cursor = new Date(boundedEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return chunks;
}

/** Builds a provider reporting window from browser-local calendar dates. */
export function buildDefaultAdsSyncWindow(end = new Date()): AdsSyncWindow {
  return buildAdsSyncWindow(subDays(end, 30), end);
}
