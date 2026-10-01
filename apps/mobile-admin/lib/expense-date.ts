const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function toPaddedNumber(value: number): string {
  return String(value).padStart(2, '0');
}

function parseDateOnly(value: string): Date | null {
  const match = DATE_ONLY_PATTERN.exec(value);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

export const expenseDateCodec = {
  toDateOnly(date: Date): string {
    if (Number.isNaN(date.getTime())) {
      throw new Error('Cannot format an invalid expense date');
    }

    const year = String(date.getFullYear()).padStart(4, '0');
    const month = toPaddedNumber(date.getMonth() + 1);
    const day = toPaddedNumber(date.getDate());

    return `${year}-${month}-${day}`;
  },
  fromDateOnly(value: string): Date | null {
    return parseDateOnly(value);
  },
};
