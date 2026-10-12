import { createHash } from 'node:crypto';
import { generateText, jsonSchema, type LanguageModel, tool } from 'ai';
import { PUBLIC_MCP_TOOLS } from '../../src/config/mcp-server-card-tools';
import { gradeCategoryGuidanceArguments } from './category-guidance-arguments';
import { categoryGuidanceCases } from './category-guidance-cases';
import { prepareCategoryGuidanceModelSchema } from './category-guidance-model-schema';

/** Invoke a model with the actual advertised guidance; never execute generated tools. */
export async function runCategoryGuidanceModelEval(model: LanguageModel) {
  const descriptor = PUBLIC_MCP_TOOLS.find((item) => item.name === 'search_products');
  if (!descriptor) throw new Error('Search products descriptor is unavailable');
  const transportSchema = prepareCategoryGuidanceModelSchema(descriptor.inputSchema);
  const cases = [];
  for (const caseId of Object.keys(categoryGuidanceCases) as (keyof typeof categoryGuidanceCases)[]) {
    const prompt = categoryGuidanceCases[caseId].prompt;
    const result = await generateText({
      model,
      prompt,
      tools: { search_products: tool({ description: descriptor.description, inputSchema: jsonSchema(transportSchema) }) },
      toolChoice: { type: 'tool', toolName: 'search_products' },
      maxOutputTokens: 1000,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(45000),
    });
    const calls = result.toolCalls.map((call) => ({ toolName: call.toolName, input: call.input }));
    const firstCall = calls[0];
    const grade = firstCall?.toolName === 'search_products'
      ? gradeCategoryGuidanceArguments(caseId, firstCall.input)
      : { passed: false, failures: ['Missing first search_products model call'] };
    cases.push({ caseId, prompt, calls, grade, finishReason: result.finishReason });
  }
  return {
    scope: 'Model argument planning only; no tool execution or ChatGPT browser verification',
    schemaSha256: createHash('sha256').update(JSON.stringify(descriptor)).digest('hex'),
    transportSchemaSha256: createHash('sha256').update(JSON.stringify(transportSchema)).digest('hex'),
    transportNote: 'Inherited schema branches and numeric constants materialized for Gemini; published schema unchanged',
    cases,
    passed: cases.every((result) => result.grade.passed),
  };
}
