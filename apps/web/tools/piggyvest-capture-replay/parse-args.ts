import z from 'zod';
import { piggyvestCaptureRequeueReasonSchema } from '@/schemas/piggyvest/webhook-capture-operator-replay';

export type OperatorCommand =
  | { kind: 'help' }
  | { kind: 'list'; limit: number; offset: number }
  | { kind: 'requeue'; captureId: string; reason: string; confirmed: boolean };

export class UsageError extends Error {
  override name = 'UsageError';
}

const limitSchema = z.coerce.number().int().min(1).max(200);
const offsetSchema = z.coerce.number().int().min(0).max(1_000_000);

function takeValue(
  argv: readonly string[],
  index: number,
  flag: string
): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--'))
    throw new UsageError(`${flag} needs a value`);
  return value;
}

export function parseOperatorArgs(argv: readonly string[]): OperatorCommand {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === 'help')
    return { kind: 'help' };

  if (command === 'list') {
    let limit = 50;
    let offset = 0;
    for (let i = 0; i < rest.length; i += 1) {
      if (rest[i] === '--limit') {
        const parsed = limitSchema.safeParse(takeValue(rest, i, '--limit'));
        if (!parsed.success) throw new UsageError('--limit must be 1 to 200');
        limit = parsed.data;
        i += 1;
      } else if (rest[i] === '--offset') {
        const parsed = offsetSchema.safeParse(takeValue(rest, i, '--offset'));
        if (!parsed.success)
          throw new UsageError('--offset must be a whole number from 0');
        offset = parsed.data;
        i += 1;
      } else throw new UsageError(`unknown option ${rest[i]}`);
    }
    return { kind: 'list', limit, offset };
  }

  if (command === 'requeue') {
    const [captureId, ...options] = rest;
    if (captureId === undefined || !z.guid().safeParse(captureId).success)
      throw new UsageError('requeue needs a capture id (a UUID from `list`)');
    let reason: string | undefined;
    let confirmed = false;
    for (let i = 0; i < options.length; i += 1) {
      if (options[i] === '--reason') {
        reason = takeValue(options, i, '--reason');
        i += 1;
      } else if (options[i] === '--yes') confirmed = true;
      else throw new UsageError(`unknown option ${options[i]}`);
    }
    const parsedReason = piggyvestCaptureRequeueReasonSchema.safeParse(
      reason ?? ''
    );
    if (!parsedReason.success)
      throw new UsageError(
        '--reason is required: 10 to 500 characters saying why (for example the fix that was deployed)'
      );
    return { kind: 'requeue', captureId, reason: parsedReason.data, confirmed };
  }

  throw new UsageError(`unknown command ${command}`);
}
