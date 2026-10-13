import {
  formatBoundedSubprocessOutput,
  redactCodexError,
  redactCodexOutput,
} from './remediation-codex-output.mjs';

export function runRemediationChecked(command, args, options) {
  const commandOptions = {
    cwd: options.cwd,
    env: options.env,
    shell: options.shell || false,
  };
  if (options.timeout !== undefined) commandOptions.timeout = options.timeout;
  const result = options.runner(command, args, commandOptions);
  if (result.error) throw redactCodexError(result.error);
  if (result.status !== 0) {
    const describedArgs = redactCodexOutput(args.join(' ')).slice(0, 200);
    throw new Error(
      `${command} ${describedArgs} failed: ${formatBoundedSubprocessOutput(result)}`
    );
  }
  return result.stdout || '';
}
