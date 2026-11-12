export function isChatwootCrossOriginPostMessageError(
  message: string
): boolean {
  return (
    /^Failed to execute ['"]postMessage['"]: target https:\/\/support\.example\.test does not match https:\/\/untrusted\.example\.test\.?$/i.test(
      message.trim()
    ) ||
    /^Unable to post message to https:\/\/support\.example\.test\. Recipient has origin https:\/\/untrusted\.example\.test\.$/i.test(
      message.trim()
    )
  );
}
