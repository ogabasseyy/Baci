import { createBuilderMcpNodeServer } from './node';
import { parseServeOptions } from './serve-options';

const { port, experience } = parseServeOptions(process.argv.slice(2));
const runtime = createBuilderMcpNodeServer({
  experience: experience ? { enabled: true } : undefined,
});
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
