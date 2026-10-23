import { z } from 'zod';
import type { ImplementedBuilderTool } from '../src/schemas/builder-implemented-tools';
import { implementedBuilderTools } from '../src/schemas/builder-implemented-tools';
import wire from './contracts.json';

const parseSchema = (schema: unknown) =>
  z.fromJSONSchema(schema as z.core.JSONSchema.JSONSchema);
export const builderWireInputs = Object.fromEntries(
  implementedBuilderTools.map((name) => [name, parseSchema(wire.inputs[name])])
) as Record<ImplementedBuilderTool, z.ZodType>;
export const builderWireOutputs = Object.fromEntries(
  implementedBuilderTools.map((name) => [name, parseSchema(wire.outputs[name])])
) as Record<ImplementedBuilderTool, z.ZodType>;
export function listedBuilderSchemas(name: ImplementedBuilderTool) {
  const input = wire.inputs[name];
  if (input.type !== 'object') throw new Error('Invalid wire contract');
  return {
    inputSchema: { ...input, type: 'object' as const },
    outputSchema: { ...wire.outputs[name], type: 'object' as const },
  };
}

/** Every declared branch is an object. Keep the advertised root explicit for SDK legacy codecs. */
export function builderSdkOutputSchema(name: ImplementedBuilderTool) {
  const schema = builderWireOutputs[name];
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'baci-checked-wire',
      validate: (value: unknown) => schema['~standard'].validate(value),
      jsonSchema: {
        input: () => listedBuilderSchemas(name).outputSchema,
        output: () => listedBuilderSchemas(name).outputSchema,
      },
    },
  };
}
