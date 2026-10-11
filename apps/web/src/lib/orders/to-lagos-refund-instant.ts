// Merchants record refunds in Nigeria wall time (Africa/Lagos, UTC+1
// year-round with no DST), but datetime-local yields a timezone-naive
// string. Stamping the Lagos offset explicitly keeps the recorded
// instant identical no matter which timezone the viewer's browser runs
// in; parsing viewer-local instead would shift the stored refunded_at
// by the viewer's UTC offset.
const LAGOS_UTC_OFFSET = '+01:00';

export function toLagosRefundInstant(naiveLocalDateTime: string): string {
  const [datePart, timePart = ''] = naiveLocalDateTime.split('T');
  const [hours = '', minutes = '', seconds = ''] = timePart.split(':');
  const time = [hours, minutes, seconds.slice(0, 2) || '00'].join(':');
  return `${datePart}T${time}${LAGOS_UTC_OFFSET}`;
}
