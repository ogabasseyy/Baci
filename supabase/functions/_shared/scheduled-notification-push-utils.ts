import { scheduledNotificationWorker } from './scheduled-notification-worker.ts';

const { asRecord } = scheduledNotificationWorker;

export function isWithinQuietHours(
  now: Date,
  start: string | null,
  end: string | null,
  timeZone = 'Africa/Lagos'
): boolean {
  if (!start || !end) return false;
  const minutes = (value: string) => {
    const [hours, mins] = value.slice(0, 5).split(':').map(Number);
    return hours * 60 + mins;
  };
  const begin = minutes(start);
  const finish = minutes(end);
  if (!Number.isFinite(begin) || !Number.isFinite(finish)) return false;
  let local: string;
  try {
    local = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      hourCycle: 'h23',
      timeZone,
    }).format(now);
  } catch {
    return false;
  }
  const current = minutes(local);
  if (begin === finish) return true;
  return begin < finish
    ? current >= begin && current < finish
    : current >= begin || current < finish;
}

export function parseExpoTicketResults(
  body: unknown,
  expected: number
): { errorCodes: string[]; statuses: string[]; ticketIds: string[] } | null {
  const tickets = asRecord(body)?.data;
  if (!Array.isArray(tickets) || tickets.length !== expected) return null;
  const results = tickets.map((ticket) => {
    const value = asRecord(ticket);
    if (value?.status === 'ok' && typeof value.id === 'string') {
      return { errorCode: '', status: 'accepted', ticketId: value.id };
    }
    if (value?.status !== 'error') return null;
    const errorCode = asRecord(value?.details)?.error;
    if (typeof errorCode !== 'string' || errorCode.length === 0) return null;
    return {
      errorCode: errorCode.slice(0, 80),
      status: 'rejected',
      ticketId: '',
    };
  });
  const validResults = results.filter(
    (result): result is NonNullable<typeof result> => result !== null
  );
  if (validResults.length !== results.length) return null;
  return {
    errorCodes: validResults.map((result) => result.errorCode),
    statuses: validResults.map((result) => result.status),
    ticketIds: validResults.map((result) => result.ticketId),
  };
}
