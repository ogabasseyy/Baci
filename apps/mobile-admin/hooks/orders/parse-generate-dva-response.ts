interface GenerateDvaResponse {
  virtualAccount?: {
    account_name?: string | null;
    account_number?: string | null;
    bank?: string | null;
    bank_name?: string | null;
  } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalNullableString(value: unknown) {
  return value === undefined || value === null || typeof value === 'string';
}

export function parseGenerateDvaResponse(
  payload: unknown
): GenerateDvaResponse | null {
  if (!isRecord(payload)) {
    return null;
  }

  if (
    !('virtualAccount' in payload) ||
    (payload.virtualAccount !== null && !isRecord(payload.virtualAccount))
  ) {
    return null;
  }

  const account = payload.virtualAccount;
  if (
    account &&
    (!isOptionalNullableString(account.account_name) ||
      !isOptionalNullableString(account.account_number) ||
      !isOptionalNullableString(account.bank) ||
      !isOptionalNullableString(account.bank_name))
  ) {
    return null;
  }

  return payload as GenerateDvaResponse;
}
