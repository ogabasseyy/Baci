import { supabaseCommandDiagnostic } from './supabase-command-diagnostic';

export function boundedPsqlDiagnostic(
  commandName: string,
  stderr: readonly Buffer[],
  stdout: readonly Buffer[] = [],
  exitCode: number | null = null
): string {
  if (commandName === 'supabase') {
    return supabaseCommandDiagnostic(Buffer.concat(stderr).toString('utf8'));
  }
  if (!/^psql(?:-[A-Za-z0-9._-]+)?$/.test(commandName)) {
    return '';
  }
  const output = Buffer.concat(stderr).toString('utf8');
  const stdoutText = Buffer.concat(stdout).toString('utf8');
  const escapedCommandName = commandName.replaceAll('.', '\\.');
  const matches = [
    ...output.matchAll(
      new RegExp(
        `^${escapedCommandName}:[^\\r\\n]*:(\\d+):[ \\t]+(?:ERROR|error):(?:[ \\t]+([0-9A-Z]{5})(?=[: \\t]|$))?`,
        'gm'
      )
    ),
  ];
  const denialOk = /^OXYGEN_ANON_DRAFT_DENIAL_OK\r?$/m.test(stdoutText);
  // The draft SQL test intentionally receives a denied 42501 before it
  // continues. Do not report that expected error as a later failure.
  if (denialOk && matches[0]?.[2] === '42501') matches.shift();
  const match = matches[0];
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
  const capturedState = /^OXYGEN_ANON_DRAFT_SQLSTATE ([0-9A-Z]{5})\r?$/m.exec(
    stdoutText
  )?.[1];
  if (capturedState && capturedState !== '00000')
    return ` (line=${line},sqlstate=${capturedState})`;
  // Test-only psql recovery emits this exact sentinel after capturing SQLSTATE
  // from the preceding failed statement. Only its five-character code escapes.
  const recoveredState = new RegExp(
    `^${escapedCommandName}:[^\\r\\n]*:\\d+:[ \\t]+(?:ERROR|error):[^\\r\\n]*\\bOXYGEN_ANON_DRAFT_SQLSTATE=([0-9A-Z]{5})(?=[: \\t]|$)`,
    'm'
  ).exec(output)?.[1];
  if (recoveredState) return ` (line=${line},sqlstate=${recoveredState})`;
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
  if (reason) return ` (line=${line},reason=${reason})`;
  // Expose only the shape of an otherwise unclassified diagnostic. In order:
  // empty first-line message, ANSI escapes, wrapper marker on a later line,
  // and a later line beginning with a SQLSTATE-shaped token. No text is logged.
  const remainder = output.slice(match?.index ?? 0);
  const laterLines = remainder.slice(errorLine.length);
  const shape = [
    /^\s*$/.test(errorLine.slice(match?.[0].length ?? 0)),
    remainder.includes(String.fromCharCode(27)),
    /anonymous draft save unexpected SQLSTATE/.test(laterLines),
    /(?:^|\r?\n)\s*[0-9A-Z]{5}(?=[:\s]|$)/.test(laterLines),
  ]
    .map((flag) => (flag ? '1' : '0'))
    .join('');
  const checkpoint = /^OXYGEN_ANON_DRAFT_POST_DO\r?$/m.test(stdoutText);
  const exit =
    exitCode === 1 || exitCode === 2 || exitCode === 3 ? exitCode : 0;
  return ` (line=${line},shape=${shape}${checkpoint ? ',checkpoint=1' : ''},exit=${exit})`;
}
