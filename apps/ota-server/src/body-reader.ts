import { ValidationError } from './validation';

const MAX_INFLIGHT_BODY_BYTES = 80 * 1024 * 1024;
let inFlightBodyBytes = 0;

function reserveBytes(delta: number): void {
  if (inFlightBodyBytes + delta > MAX_INFLIGHT_BODY_BYTES) {
    throw new ValidationError(
      'Concurrent upload memory limit exceeded; retry shortly',
      503
    );
  }
  inFlightBodyBytes += delta;
}

export async function readBodyBytesWithLimit(
  request: Request,
  maxBytes: number
): Promise<Uint8Array> {
  const rawContentLength = request.headers.get('content-length');
  let declaredBytes: number | null = null;
  if (rawContentLength !== null) {
    const declared = Number(rawContentLength.trim());
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new ValidationError(
        `Request body exceeds maximum allowed size of ${maxBytes} bytes`,
        413
      );
    }
    if (Number.isInteger(declared) && declared >= 0) {
      declaredBytes = declared;
    }
  }

  if (!request.body) {
    return new Uint8Array(0);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let reserved = 0;
  let total = 0;

  try {
    if (declaredBytes !== null && declaredBytes > 0) {
      reserveBytes(declaredBytes);
      reserved = declaredBytes;
      const out = new Uint8Array(declaredBytes);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (total + value.byteLength > maxBytes) {
          await reader.cancel();
          throw new ValidationError(
            `Request body exceeds maximum allowed size of ${maxBytes} bytes`,
            413
          );
        }
        if (total + value.byteLength <= out.byteLength) {
          out.set(value, total);
          total += value.byteLength;
          continue;
        }
        if (chunks.length === 0 && total > 0) {
          chunks.push(out.subarray(0, total));
        }
        const extraNeeded = total + value.byteLength - reserved;
        if (extraNeeded > 0) {
          reserveBytes(extraNeeded);
          reserved += extraNeeded;
        }
        total += value.byteLength;
        chunks.push(value);
      }
      if (chunks.length === 0) {
        return total === out.byteLength ? out : out.subarray(0, total);
      }
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      chunks.length = 0;
      return merged;
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ValidationError(
          `Request body exceeds maximum allowed size of ${maxBytes} bytes`,
          413
        );
      }
      reserveBytes(value.byteLength);
      reserved += value.byteLength;
      chunks.push(value);
    }

    if (chunks.length === 0) {
      return new Uint8Array(0);
    }
    if (chunks.length === 1) {
      const only = chunks[0];
      chunks.length = 0;
      return only ?? new Uint8Array(0);
    }

    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    chunks.length = 0;
    return out;
  } finally {
    inFlightBodyBytes = Math.max(0, inFlightBodyBytes - reserved);
  }
}
