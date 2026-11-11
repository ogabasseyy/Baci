/** @param {import('node:stream').Readable} stream @param {number} [limit] */
export async function readBoundedUtf8(stream, limit = 8 * 1024 * 1024) {
  stream.setEncoding('utf8');
  let text = '';
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > limit) throw Error('Input budget');
    text += chunk;
  }
  return text;
}
