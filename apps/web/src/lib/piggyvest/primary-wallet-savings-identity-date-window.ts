import { z } from 'zod';

const dayMs = 24 * 60 * 60 * 1000;

export function primarySavingsIdentityDateWindow(value: unknown) {
  const parsed = z.iso.datetime({ offset: true }).safeParse(value);
  if (!parsed.success) return null;
  const timestamp = Date.parse(parsed.data);
  if (!Number.isFinite(timestamp)) return null;
  return {
    startDate: new Date(timestamp - dayMs).toISOString(),
    endDate: new Date(timestamp + dayMs).toISOString(),
  };
}
