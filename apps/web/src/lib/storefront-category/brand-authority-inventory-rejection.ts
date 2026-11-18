export class ExpectedBrandAuthorityInventoryRejectionError extends Error {
  readonly isExpectedRejection = true;

  constructor(message: string) {
    super(message);
    this.name = 'ExpectedBrandAuthorityInventoryRejectionError';
  }
}

export function isExpectedBrandAuthorityInventoryRejection(
  error: unknown
): error is ExpectedBrandAuthorityInventoryRejectionError {
  if (!error || typeof error !== 'object') return false;
  if (error instanceof ExpectedBrandAuthorityInventoryRejectionError) {
    return true;
  }
  return (
    'isExpectedRejection' in error &&
    (error as { isExpectedRejection?: unknown }).isExpectedRejection === true
  );
}
