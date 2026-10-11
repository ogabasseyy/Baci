// Single-shot worker entry point, split from encode-worker.mjs under the
// repo line ceiling (same pattern as encode-worker-formats.mjs). The pool
// spawns this file with a JSON op in argv[2]; handled outcomes (including
// input rejections) exit 0 with a single JSON result on stdout, while
// protocol misuse or unexpected crashes exit non-zero so the parent can
// distinguish rejection from worker failure.
import { fileURLToPath } from 'node:url';
import {
  errorMessage,
  handleEncodeOp,
  handleMetadataOp,
  handleVerifyOp,
  WorkerInputError,
} from './encode-worker.mjs';

function parseOp(raw) {
  if (!raw) {
    throw new WorkerInputError('bad-request', 'missing op JSON');
  }
  let op;
  try {
    op = JSON.parse(raw);
  } catch {
    throw new WorkerInputError('bad-request', 'op is not valid JSON');
  }
  if (!op || typeof op !== 'object' || typeof op.input !== 'string') {
    throw new WorkerInputError('bad-request', 'op requires an input path');
  }
  if (op.op !== 'metadata' && op.op !== 'encode' && op.op !== 'verify') {
    throw new WorkerInputError('bad-request', `unknown op "${op?.op}"`);
  }
  if (op.op === 'encode' && typeof op.output !== 'string') {
    throw new WorkerInputError('bad-request', 'encode requires an output path');
  }
  return op;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    let op;
    try {
      op = parseOp(process.argv[2]);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 2;
      return;
    }
    try {
      // Worker self-report for job memory accounting: max RSS at op start
      // and completion. Single-shot workers hold their peak through result
      // serialization, so the end sample approximates the op peak; spikes
      // inside one native call may exceed it (documented at the consumer).
      const startRss = process.memoryUsage().rss;
      const result =
        op.op === 'metadata'
          ? await handleMetadataOp(op)
          : op.op === 'encode'
            ? await handleEncodeOp(op)
            : await handleVerifyOp(op);
      result.workerPeakRssBytes = Math.max(
        startRss,
        process.memoryUsage().rss
      );
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      if (error instanceof WorkerInputError) {
        process.stdout.write(
          `${JSON.stringify({ code: error.code, message: error.message, ok: false })}\n`
        );
        return;
      }
      console.error(errorMessage(error));
      process.exitCode = 1;
    }
  })();
}
