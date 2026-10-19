const LAGOS_DATE_PARTS_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Africa/Lagos',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

function getMillisecondsUntilNextLagosMidnight(now: Date): number {
  const parts = LAGOS_DATE_PARTS_FORMATTER.formatToParts(now);
  const values = Object.fromEntries(
    parts
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)])
  );
  const nextMidnightUtc = Date.UTC(
    values.year,
    values.month - 1,
    values.day + 1,
    -1
  );
  return Math.max(1, nextMidnightUtc - now.getTime());
}

export function scheduleLagosMidnightRefresh(onRefresh: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;

  const schedule = () => {
    timer = setTimeout(() => {
      if (cancelled) return;
      onRefresh();
      schedule();
    }, getMillisecondsUntilNextLagosMidnight(new Date()));
  };

  schedule();
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}
