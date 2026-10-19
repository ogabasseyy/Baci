export async function readBoundedJson(response, { label, maxBytes }) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error(`${label} had no readable response body`);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`${label} exceeded the ${maxBytes}-byte body cap`);
    }
    chunks.push(value);
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error(`${label} was invalid JSON`);
  }
  return payload;
}
