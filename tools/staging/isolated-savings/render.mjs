import { composeTemplate } from './compose.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--template') {
  process.stderr.write('Usage: node render.mjs --template\n');
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify(composeTemplate(), null, 2)}\n`);
}
