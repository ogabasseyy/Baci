#!/usr/bin/env node
// CLI 57 redacts unavailable sensitive values as [SENSITIVE], not credentials.
// Normalize only that reserved transport marker in the prebuilt input. Vercel
// still injects and validates the real Production values at runtime.
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';

const [file, ...extra] = process.argv.slice(2);
if (!file || extra.length) throw new Error('Expected one pulled build-env file');
const stat = lstatSync(file);
if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Build-env input must be a regular file');

const source = readFileSync(file, 'utf8');
let count = 0;
const normalized = source.replace(
  /^((?:export[ \t]+)?[A-Za-z_][A-Za-z0-9_]*[ \t]*=)[ \t]*(?:"\[SENSITIVE\]"|'\[SENSITIVE\]'|\[SENSITIVE\])[ \t]*(\r?)$/gm,
  (_match, assignment, carriageReturn) => {
    count += 1;
    return assignment + '""' + carriageReturn;
  },
);
if (count) writeFileSync(file, normalized);
console.log(`Normalized ${count} sensitive build placeholders.`);
