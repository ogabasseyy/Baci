const isIsoDate = (value) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

export function normalizeRemediationNotifications(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([id, entry]) => {
      const report = entry?.report;
      if (
        entry &&
        typeof entry === 'object' &&
        isIsoDate(entry.recordedAt) &&
        report &&
        typeof report.html === 'string' &&
        typeof report.subject === 'string' &&
        typeof report.text === 'string'
      ) {
        const notification = {
          recordedAt: entry.recordedAt,
          report: {
            html: report.html,
            subject: report.subject,
            text: report.text,
          },
        };
        if (Number.isSafeInteger(entry.attempts) && entry.attempts >= 0) {
          notification.attempts = entry.attempts;
        }
        if (isIsoDate(entry.nextAttemptAt)) {
          notification.nextAttemptAt = entry.nextAttemptAt;
        }
        return [[id, notification]];
      }
      return [];
    })
  );
}
