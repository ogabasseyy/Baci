export function readFlags(name: string): string[] {
  return process.argv.flatMap((value, index) => {
    const next = process.argv[index + 1];
    return value === name && next ? [next] : [];
  });
}

export function readFlag(name: string): string {
  const [value] = readFlags(name);
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`);
  return value;
}
