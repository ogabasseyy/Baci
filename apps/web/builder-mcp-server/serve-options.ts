export function parseServeOptions(args: string[]) {
  let port: number | undefined;
  let experience = false;
  for (const arg of args) {
    if (arg === '--experience' && !experience) experience = true;
    else if (/^\d+$/.test(arg) && port === undefined) port = Number(arg);
    else throw new Error('Invalid listener argument');
  }
  port ??= 8790;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid listener port');
  return { port, experience };
}
