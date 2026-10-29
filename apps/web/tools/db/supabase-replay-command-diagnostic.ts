import { supabaseCommandDiagnostic } from './supabase-command-diagnostic';
import { supabaseReplayFailureDiagnostic } from './supabase-replay-failure-diagnostic';

export type ReplayCommandFailureClass =
  | 'non-zero-exit'
  | 'spawn-error'
  | 'stderr-limit'
  | 'stdin-limit'
  | 'stdout-limit'
  | 'timeout';

function sanitizedCommandName(command: string): string {
  const basename = command.split(/[\\/]/).at(-1) ?? '';
  return /^[A-Za-z0-9._-]+$/.test(basename) ? basename : 'command';
}

function safePermissionCategory(message: string): string | undefined {
  const normalized = message.trim().toLowerCase();
  if (
    /^must be owner of (?:table|relation|schema|function|procedure|sequence|type)\b/.test(
      normalized
    )
  )
    return 'owner_required';
  if (/^permission denied for schema\b/.test(normalized))
    return 'schema_access_denied';
  if (
    /^permission denied for (?:table|relation|view|materialized view)\b/.test(
      normalized
    )
  )
    return 'relation_access_denied';
  if (/^permission denied for (?:function|procedure)\b/.test(normalized))
    return 'routine_access_denied';
  if (/^permission denied for column\b/.test(normalized))
    return 'column_access_denied';
  if (/^permission denied for sequence\b/.test(normalized))
    return 'sequence_access_denied';
  if (/^permission denied to set role\b/.test(normalized))
    return 'role_membership_denied';
  if (/^permission denied\b/.test(normalized)) return 'permission_denied';
  return undefined;
}

function boundedPsqlDiagnostic(
  command: string,
  stderr: readonly Buffer[],
  stdout: readonly Buffer[]
): string {
  const commandName = sanitizedCommandName(command);
  if (commandName === 'supabase') {
    return supabaseCommandDiagnostic(Buffer.concat(stderr).toString('utf8'));
  }
  if (!/^psql(?:-[A-Za-z0-9._-]+)?$/.test(commandName)) return '';

  const output = Buffer.concat(stderr).toString('utf8');
  const escapedCommandName = commandName.replaceAll('.', '\\.');
  const match = new RegExp(
    `^${escapedCommandName}:[^\\r\\n]*:(\\d+):[ \\t]+(?:ERROR|error):(?:[ \\t]+([0-9A-Z]{5})(?=[: \\t]|$))?`,
    'm'
  ).exec(output);
  const line = Number(match?.[1]);
  if (!Number.isSafeInteger(line) || line < 1) return '';

  const sqlstate = match?.[2];
  const errorMessage = new RegExp(
    `^${escapedCommandName}:[^\\r\\n]*:${line}:[ \\t]+(?:ERROR|error):[ \\t]+(?:(?:[0-9A-Z]{5}):[ \\t]*)?([^\\r\\n]*)`,
    'm'
  ).exec(output)?.[1];
  // Expose only fixed categories; never echo server messages or object names.
  const permissionCategory =
    sqlstate === '42501' && errorMessage
      ? safePermissionCategory(errorMessage)
      : undefined;
  const tapFailure = /^\s*not ok\s+(\d+)(?:\s|$)/m.exec(
    Buffer.concat(stdout).toString('utf8')
  )?.[1];
  const tapIndex = tapFailure ? Number(tapFailure) : undefined;
  const safeTapIndex =
    tapIndex !== undefined &&
    Number.isSafeInteger(tapIndex) &&
    tapIndex > 0 &&
    tapIndex <= 100_000
      ? tapIndex
      : undefined;

  return ` (line=${line}${sqlstate ? `,sqlstate=${sqlstate}` : ''}${permissionCategory ? `,permission=${permissionCategory}` : ''}${safeTapIndex ? `,tap=${safeTapIndex}` : ''})`;
}

export function replayCommandFailure(
  command: string,
  failure: ReplayCommandFailureClass,
  stderr: readonly Buffer[] = [],
  stdout: readonly Buffer[] = []
): Error {
  const diagnostic =
    failure !== 'non-zero-exit'
      ? ''
      : sanitizedCommandName(command) === 'supabase'
        ? supabaseReplayFailureDiagnostic(
            Buffer.concat(stderr).toString('utf8')
          )
        : boundedPsqlDiagnostic(command, stderr, stdout);
  return new Error(
    `${sanitizedCommandName(command)} failed: ${failure}${diagnostic}`
  );
}
