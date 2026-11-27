/**
 * A reminder's time, to the whole second: the chat engine is sent (and shows)
 * no more than that, so two times within one second are one follow-up and must
 * not be told apart. Throws on a value that is not a time.
 */
export function reminderDueAt(followUpAt: string): string {
  return new Date(
    Math.floor(Date.parse(followUpAt) / 1000) * 1000
  ).toISOString();
}
