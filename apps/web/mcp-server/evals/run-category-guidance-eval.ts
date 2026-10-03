import { readFileSync } from 'node:fs';
import { categoryGuidanceCases, gradeCategoryGuidance } from './category-guidance-eval';

const [caseId, tracePath] = process.argv.slice(2);
if (!caseId || !Object.hasOwn(categoryGuidanceCases, caseId) || !tracePath) {
  console.error('Usage: tsx mcp-server/evals/run-category-guidance-eval.ts camera|tecno|explicitCategory /absolute/native-cdp-traces.json');
  process.exit(1);
}
try {
  const result = gradeCategoryGuidance(
    caseId as keyof typeof categoryGuidanceCases,
    JSON.parse(readFileSync(tracePath, 'utf8')) as unknown
  );
  console.log(JSON.stringify({ caseId, tracePath, ...result }, null, 2));
  process.exitCode = result.passed ? 0 : 1;
} catch {
  console.error('Category guidance eval failed: trace file could not be read or parsed as JSON.');
  process.exitCode = 1;
}
