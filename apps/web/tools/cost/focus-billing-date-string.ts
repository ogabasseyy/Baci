/** Parses a FOCUS ISO-8601 charge/window timestamp and rejects impossible calendars. */
export function dateString(value: unknown, field: string) {
  if (typeof value !== 'string')
    throw new Error(`billing row has an invalid ${field}`);
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/
  );
  if (!match) throw new Error(`billing row has an invalid ${field}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day ||
    probe.getUTCHours() !== hour ||
    probe.getUTCMinutes() !== minute ||
    probe.getUTCSeconds() !== second
  ) {
    throw new Error(`billing row has an invalid ${field}`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp))
    throw new Error(`billing row has an invalid ${field}`);
  return new Date(timestamp).toISOString();
}
