/** Provider codes emitted only after the server confirms wallet refund. */
export function isConfirmedImeiRefund(
  status: number,
  code: string | null | undefined
): boolean {
  return (
    (status === 404 &&
      (code === 'SICKW_NOT_FOUND' || code === 'PETROCK_REJECTED')) ||
    (status === 502 &&
      (code === 'SICKW_UNAVAILABLE' ||
        code === 'PETROCK_NOT_SUBMITTED' ||
        code === 'PETROCK_REJECTED' ||
        code === 'PETROCK_UNAVAILABLE'))
  );
}
