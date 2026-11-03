type RecipientQuery = {
  in: (column: string, values: string[]) => unknown;
};

/**
 * Narrows a merchant push-token query to the given recipient user ids.
 * An undefined list keeps the legacy "every admin token" behaviour; callers
 * that need a restriction pass a list (an empty list means nobody).
 */
export function restrictPushTokensToRecipients<T extends RecipientQuery>(
  query: T,
  recipientUserIds?: string[]
): T {
  return recipientUserIds
    ? (query.in('user_id', recipientUserIds) as T)
    : query;
}
