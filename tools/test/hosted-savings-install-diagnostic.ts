export function hostedSavingsInstallDiagnostic(value: string) {
  const postgres =
    /^(?:psql:<stdin>:(\d+):\s*)?(?:ERROR|FATAL|PANIC):\s+([0-9A-Z]{5})(?=[:\s]|$)/m.exec(
      value
    );
  const internal =
    /^Installer command failed(?: SQLSTATE=([0-9A-Z]{5}))?(?: LINE=(\d+))?(?: EXIT=(\d+))?(?: SIGNAL=(SIG[A-Z0-9]+))?; output redacted$/.exec(
      value
    );
  const sqlstate = postgres?.[2] ?? internal?.[1];
  const line = Number(postgres?.[1] ?? internal?.[2]);
  const exitCode =
    internal?.[3] === undefined ? undefined : Number(internal[3]);
  const signal = internal?.[4];
  return {
    ...(sqlstate ? { sqlstate } : {}),
    ...(Number.isSafeInteger(line) && line > 0 ? { line } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(signal ? { signal } : {}),
  };
}
