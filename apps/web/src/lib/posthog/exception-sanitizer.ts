import { sanitizePostHogExceptionText } from '@/lib/posthog/exception-text';
import { sanitizePostHogProperties } from '@/lib/posthog/property-sanitizer';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeExceptionValue(
  value: unknown,
  seen: WeakSet<object>
): unknown {
  if (value instanceof Error) {
    return cloneSanitizedException(value, seen);
  }

  if (typeof value === 'string') {
    return sanitizePostHogExceptionText(value);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.add(value);
    const sanitizedArray = value.map((item) =>
      sanitizeExceptionValue(item, seen)
    );
    seen.delete(value);
    return sanitizedArray;
  }

  if (isRecord(value)) {
    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.add(value);
    const sanitizedRecord = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sanitizeExceptionValue(item, seen),
      ])
    );
    seen.delete(value);

    return sanitizePostHogProperties(sanitizedRecord);
  }

  return value;
}

function cloneSanitizedException(error: Error, seen: WeakSet<object>): Error {
  if (seen.has(error)) {
    return new Error('[Circular]');
  }

  seen.add(error);
  const sanitizedError = new Error(sanitizePostHogExceptionText(error.message));
  sanitizedError.name = error.name;

  if (error.stack) {
    sanitizedError.stack = sanitizePostHogExceptionText(error.stack);
  }

  if ('cause' in error) {
    Object.defineProperty(sanitizedError, 'cause', {
      configurable: true,
      enumerable: false,
      value: sanitizeExceptionValue(
        (error as Error & { cause?: unknown }).cause,
        seen
      ),
      writable: true,
    });
  }

  seen.delete(error);
  return sanitizedError;
}

export function sanitizePostHogException(error: unknown): unknown {
  return sanitizeExceptionValue(error, new WeakSet<object>());
}
