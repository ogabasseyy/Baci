import { readFileSync } from 'node:fs';
import { categoryGuidanceCases } from './category-guidance-cases';
import { gradeCategoryGuidance } from './category-guidance-eval';

const [caseId, tracePath] = process.argv.slice(2);
if (!caseId || !Object.hasOwn(categoryGuidanceCases, caseId) || !tracePath) {
  console.error('Usage: tsx mcp-server/evals/run-category-guidance-eval.ts camera|tecno|explicitCategory /absolute/native-cdp-traces.json');
  process.exit(1);
}
try {
  const parsed: unknown = JSON.parse(readFileSync(tracePath, 'utf8'));
  const traces = Array.isArray(parsed) ? parsed : parsed !== null && typeof parsed === 'object' && 'traces' in parsed ? parsed.traces : undefined;
  if (!Array.isArray(traces)) {
    console.error('Category guidance eval failed: expected a native CDP trace array or an object with a traces array.');
    process.exit(1);
  }
  const result = gradeCategoryGuidance(
    caseId as keyof typeof categoryGuidanceCases,
    traces
  );
  console.log(JSON.stringify({ caseId, tracePath, ...result }, null, 2));
  process.exitCode = result.passed ? 0 : 1;
} catch {
  console.error('Category guidance eval failed: trace file could not be read or parsed as JSON.');
  process.exitCode = 1;
}
