import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { builderError } from '../src/lib/builder-connector/errors';
import { builderAuthChallenge } from '../src/lib/builder-connector/tool-policy';
import type { ImplementedBuilderTool } from '../src/schemas/builder-implemented-tools';
import { builderFailureSchema } from '../src/schemas/builder-mcp-failure';
import { builderWireOutputs } from './contracts';
/** Validate before text formatting: neither unknown fields nor raw exceptions cross MCP. */
export function builderToolResult(
  tool: ImplementedBuilderTool,
  value: unknown
): CallToolResult {
  const parsed = builderWireOutputs[tool].safeParse(value);
  const record = parsed.success
    ? z.record(z.string(), z.unknown()).safeParse(parsed.data)
    : undefined;
  const result = record?.success
    ? record.data
    : builderError('OPERATION_FAILED');
  const failure = builderFailureSchema.safeParse(result);
  if (result.status === 'error' && !failure.success)
    return builderToolResult(tool, builderError('OPERATION_FAILED'));
  if (failure.success) {
    const error = failure.data;
    if (
      error.code === 'CONNECTION_REVOKED' ||
      error.code === 'INSUFFICIENT_SCOPE'
    )
      return builderAuthChallenge(error.code, tool);
    const safe =
      error.code === 'STALE_DRAFT'
        ? builderError(error.code, error.currentVersion ?? '')
        : builderError(error.code);
    return {
      isError: true,
      content: [{ type: 'text', text: safe.error }],
      structuredContent: safe,
    };
  }
  return {
    isError: false,
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result,
  };
}
