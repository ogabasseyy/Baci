import { createBuilderMcpNodeServer } from './node';

const port = Number(process.argv[2] ?? 8790);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('Invalid listener port');
const runtime = createBuilderMcpNodeServer();
runtime.server.listen(port, '127.0.0.1');
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  void runtime.close().catch(() => {
    process.exitCode = 1;
  });
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
