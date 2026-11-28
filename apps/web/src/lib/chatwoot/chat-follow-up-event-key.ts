const REMINDER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The event key the database gives a reminder's push event. Throws for an id
 * that is not a UUID, so a malformed id can never produce a plausible key.
 */
export function chatFollowUpEventKey(reminderId: string): string {
  if (!REMINDER_ID_PATTERN.test(reminderId)) {
    throw new Error('Reminder id is not a UUID');
  }
  return `fu-${reminderId.replaceAll('-', '')}`;
}
