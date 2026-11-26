import { compileStorefrontWorker } from './compiler/compile-storefront';

async function readStdinUtf8(maxBytes = 2 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.byteLength;
    if (total > maxBytes) {
      throw new Error('Compiler stdin payload exceeded 2 MiB wire limit');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const raw = await readStdinUtf8();
  const parsed: unknown = JSON.parse(raw);
  const compiled = await compileStorefrontWorker(parsed);
  process.stdout.write(`${JSON.stringify(compiled)}\n`);
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Storefront compilation failed';
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exitCode = 1;
});
