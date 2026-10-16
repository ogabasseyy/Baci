// Bounded served-response reader for the preflight served gate: streams
// at most maxBytes so a runaway origin cannot exhaust the validator.
// Split from merchant-image-pilot-preflight-served-checks.mjs under the
// repo line ceiling.

// Bounded response read: at most maxBytes stream through the reader, so a
// runaway origin cannot exhaust the validator. Reports truncation (the
// caller fails the byte check) and cancels the body on overflow.
export async function readBoundedBody(response, maxBytes) {
  if (!response.body) {
    return { bytes: Buffer.alloc(0), truncated: false };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return { bytes: Buffer.concat(chunks), truncated: false };
      }
      total += value.byteLength;
      if (total > maxBytes) {
        return { bytes: Buffer.alloc(0), truncated: true };
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
