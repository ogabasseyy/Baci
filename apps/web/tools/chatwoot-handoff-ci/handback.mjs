export async function publishFollowupAfterPending({
  readConversation,
  publishFollowup,
}) {
  const conversation = await readConversation();
  if (conversation.status !== 'pending')
    throw new Error(
      `Expected pending handback, received ${conversation.status}`
    );
  await publishFollowup();
}
