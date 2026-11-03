import { supabaseCommandDiagnostic } from './supabase-command-diagnostic';

export function boundedPsqlDiagnostic(
  commandName: string,
  stderr: readonly Buffer[]
): string {
  if (commandName === 'supabase') {
    return supabaseCommandDiagnostic(Buffer.concat(stderr).toString('utf8'));
  }
  if (!/^psql(?:-[A-Za-z0-9._-]+)?$/.test(commandName)) {
    return '';
  }
  const output = Buffer.concat(stderr).toString('utf8');
  const escapedCommandName = commandName.replaceAll('.', '\\.');
  const match = new RegExp(
    `^${escapedCommandName}:[^\\r\\n]*:(\\d+):[ \\t]+(?:ERROR|error):(?:[ \\t]+([0-9A-Z]{5})(?=[: \\t]|$))?`,
    'm'
  ).exec(output);
  const line = Number(match?.[1]);
  if (!Number.isSafeInteger(line) || line < 1) return '';
  if (match?.[2]) return ` (line=${line},sqlstate=${match[2]})`;
  // The client/server may not emit SQLSTATE. Never return raw stderr: only
  // classify a fixed set of error categories, with no identifiers or values.
  const errorLine = output.slice(match?.index ?? 0).split(/\r?\n/, 1)[0] ?? '';
  const wrappedState =
    /anonymous draft save unexpected SQLSTATE ([0-9A-Z]{5})(?=\s|$)/.exec(
      errorLine
    )?.[1];
  if (wrappedState) return ` (line=${line},sqlstate=${wrappedState})`;
  const reason = /anonymous draft save executed/i.test(errorLine)
    ? 'anonymous-draft-save-executed'
    : /permission denied/i.test(errorLine)
      ? 'permission-denied'
      : /function .+ does not exist/i.test(errorLine)
        ? 'undefined-function'
        : /column .+ does not exist/i.test(errorLine)
          ? 'undefined-column'
          : /invalid input syntax/i.test(errorLine)
            ? 'invalid-input'
            : /duplicate key/i.test(errorLine)
              ? 'unique-violation'
              : null;
  return ` (line=${line}${reason ? `,reason=${reason}` : ''})`;
}
