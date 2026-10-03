import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIVE_TEXT_MODEL_NAME, activeTextModel } from '../../src/ai/provider';
import { runCategoryGuidanceModelEval } from './category-guidance-model-eval';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

async function main() {
  const outputPath = process.argv[2];
  if (!outputPath || !isAbsolute(outputPath) || !outputPath.endsWith('.json')) {
    console.error('Usage: tsx mcp-server/evals/run-category-guidance-model-eval.ts /absolute/evidence.json');
    process.exitCode = 1;
  } else if (![process.env.GOOGLE_GENAI_API_KEY, process.env.GEMINI_API_KEY, process.env.GOOGLE_GENERATIVE_AI_API_KEY].some(Boolean)) {
    console.error('Model evaluation requires the normal configured Google test environment. No calls made.');
    process.exitCode = 1;
  } else {
    try {
      const result = await runCategoryGuidanceModelEval(activeTextModel);
      const provenance = {
        model: ACTIVE_TEXT_MODEL_NAME,
        capturedAt: new Date().toISOString(),
        baseHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: repositoryRoot }).trim(),
        worktreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8', cwd: repositoryRoot }).trim()),
        samplesPerCase: 1,
      };
      writeFileSync(outputPath, JSON.stringify({ provenance, ...result }, null, 2));
      console.log(JSON.stringify({ passed: result.passed, cases: result.cases.length, model: ACTIVE_TEXT_MODEL_NAME }));
      if (!result.passed) process.exitCode = 1;
    } catch (error) {
      // Provider request/response objects may contain credentials. Never print them.
      console.error(JSON.stringify({ error: error instanceof Error ? error.name : 'UnknownModelError' }));
      process.exitCode = 1;
    }
  }
}

void main();
