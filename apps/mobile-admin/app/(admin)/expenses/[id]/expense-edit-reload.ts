export function shouldResetExpenseEditDraftOnReload(result: {
  isSuccess: boolean;
  data: unknown;
}): boolean {
  return result.isSuccess && result.data != null;
}
