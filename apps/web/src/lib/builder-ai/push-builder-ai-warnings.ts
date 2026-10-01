export function pushBuilderAiWarnings(
  target: string[],
  warnings: string[]
): void {
  for (const warning of warnings) {
    if (target.length >= 10) return;
    target.push(warning.slice(0, 160));
  }
}
