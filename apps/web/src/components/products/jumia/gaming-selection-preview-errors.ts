type PreviewRequestError = Error & { status: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function makeRequestError(status: number, message: string) {
  return Object.assign(new Error(message), { status }) as PreviewRequestError;
}

function makeInvalidPageResponseError() {
  return makeRequestError(
    422,
    'Unable to read the Gaming preview. Please create it again.'
  );
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

function isRejectedCachedSelection(cause: unknown) {
  return isRecord(cause) && (cause.status === 410 || cause.status === 422);
}

export const gamingSelectionPreviewErrors = {
  errorMessage,
  isRecord,
  isRejected: isRejectedCachedSelection,
  makeInvalidPageResponseError,
  makeRequestError,
};
