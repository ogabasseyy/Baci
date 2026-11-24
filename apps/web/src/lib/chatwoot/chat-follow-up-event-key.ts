/** The event key the database gives a reminder's push event. */
export function chatFollowUpEventKey(reminderId: string): string {
  return `fu-${reminderId.replaceAll('-', '')}`;
}
