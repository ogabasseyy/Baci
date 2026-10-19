const pidPattern = /^[1-9]\d*$/;
const userPattern = /^[a-z_][a-z0-9_-]{0,31}$/;

function requireValue(value) {
  if (!value) throw new Error('Rejected');
}

function parseProcesses(output) {
  requireValue(typeof output === 'string');
  const records = output
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.trim().split(/\s+/));
  requireValue(records.length > 0);
  return records.map(([pid, parentPid, user, command, ...extra]) => {
    requireValue(
      extra.length === 0 &&
        pidPattern.test(pid) &&
        pidPattern.test(parentPid) &&
        userPattern.test(user) &&
        command === 'nginx'
    );
    return { pid, parentPid, user };
  });
}

export function selectPublicNginxWorkers(output, mainPid) {
  requireValue(typeof mainPid === 'string' && pidPattern.test(mainPid));
  const processes = parseProcesses(output);
  requireValue(
    processes.some(
      (process) => process.pid === mainPid && process.user === 'root'
    )
  );
  const workers = processes
    .filter(
      (process) => process.parentPid === mainPid && process.user !== 'root'
    )
    .map(({ pid, user }) => ({ pid, user }));
  requireValue(workers.length > 0);
  return workers;
}
