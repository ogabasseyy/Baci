import { JumiaPartialUpdateError } from './jumia-partial-update-error';

export function getJumiaSaveErrorMessage(error: unknown): string {
  if (error instanceof JumiaPartialUpdateError) {
    const suffix =
      error.feedIds.length > 0
        ? ` (Jumia feed: ${error.feedIds.join(', ')})`
        : '';
    return `${error.message}${suffix}`;
  }
  return error instanceof Error ? error.message : 'Unknown error';
}
