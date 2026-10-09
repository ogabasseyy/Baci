export interface TransactionReviewRangeParams {
  endDate: Date;
  startDate: Date;
}

/** Parses optional start/end date-route params into a valid range. */
export function parseTransactionReviewRangeParams(
  startDateParam: string | string[] | undefined,
  endDateParam: string | string[] | undefined
): TransactionReviewRangeParams | undefined {
  const startValue = Array.isArray(startDateParam)
    ? startDateParam[0]
    : startDateParam;
  const endValue = Array.isArray(endDateParam) ? endDateParam[0] : endDateParam;
  const startDate = startValue ? new Date(startValue) : undefined;
  const endDate = endValue ? new Date(endValue) : undefined;

  if (
    !startDate ||
    !endDate ||
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime()) ||
    startDate.getTime() > endDate.getTime()
  ) {
    return undefined;
  }

  return { endDate, startDate };
}
