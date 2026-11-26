import { z } from 'zod';
import type { ExperienceToolName } from '../src/schemas/experience-tools';
import output from './experience-contracts.json';
import inputs from './experience-wire-inputs';
export function listedExperienceSchemas(name: ExperienceToolName) {
  return {
    inputSchema: { ...inputs[name], type: 'object' as const },
    outputSchema: { ...output, type: 'object' as const },
  };
}
export const experienceWireInputs = Object.fromEntries(
  Object.entries(inputs).map(([n, s]) => [
    n,
    z.fromJSONSchema(s as z.core.JSONSchema.JSONSchema),
  ])
) as Record<ExperienceToolName, z.ZodType>;
export const experienceWireOutput = z.fromJSONSchema(
  output as unknown as z.core.JSONSchema.JSONSchema
);
export function experienceSdkOutputSchema() {
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'baci-experience-wire',
      validate: (v: unknown) => experienceWireOutput['~standard'].validate(v),
      jsonSchema: { input: () => output, output: () => output },
    },
  };
}
