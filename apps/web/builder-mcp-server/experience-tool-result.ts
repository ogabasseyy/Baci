import type { CallToolResult } from '@modelcontextprotocol/server';
import { experienceToolPolicy } from '../src/lib/experience/tool-policy';
import { experienceEvidenceId } from '../src/schemas/experience-evidence-row';
import {
  experienceError,
  experienceMcpResultEnvelope,
} from '../src/schemas/experience-tool-results';
import type { ExperienceToolName } from '../src/schemas/experience-tools';
import { experienceWireOutput } from './experience-contracts';
import type { createExperienceEvidenceClient } from './experience-evidence-client';
export async function experienceMcpToolResult(
  name: ExperienceToolName,
  value: unknown,
  options?: {
    evidenceId?: string;
    token: string;
    readImage: ReturnType<typeof createExperienceEvidenceClient>;
    signal?: AbortSignal;
  }
): Promise<CallToolResult> {
  const parsed = experienceWireOutput.safeParse(value);
  const result = parsed.success ? parsed.data : experienceError('UNAVAILABLE');
  const json = JSON.stringify(result);
  if (Buffer.byteLength(json) > 98304)
    return experienceMcpToolResult(name, experienceError('QUOTA_EXCEEDED'));
  const envelope = experienceMcpResultEnvelope.parse(result);
  const content: CallToolResult['content'] = [{ type: 'text', text: json }];
  if (name === 'read_experience_evidence' && envelope.status === 'ok') {
    if (
      !options ||
      typeof options.evidenceId !== 'string' ||
      !experienceEvidenceId.safeParse(envelope.value?.evidenceId).success ||
      envelope.value?.evidenceId !== options.evidenceId
    )
      return experienceMcpToolResult(name, experienceError('NOT_FOUND'));
    try {
      content.push(
        await options.readImage(
          options.token,
          options.evidenceId,
          options.signal
        )
      );
    } catch {
      return experienceMcpToolResult(name, experienceError('UNAVAILABLE'));
    }
  }
  return {
    isError: envelope.status === 'error',
    ...(['CONNECTION_REVOKED', 'INSUFFICIENT_SCOPE'].includes(
      envelope.code ?? ''
    )
      ? {
          _meta: {
            'mcp/www_authenticate': [
              `Bearer resource_metadata="https://mcp.usebaci.com/.well-known/oauth-protected-resource/builder/mcp", scope="${experienceToolPolicy[name].scopes.join(' ')}", error="${envelope.code === 'INSUFFICIENT_SCOPE' ? 'insufficient_scope' : 'invalid_token'}"`,
            ],
          },
        }
      : {}),
    content,
    structuredContent: result as Record<string, unknown>,
  };
}
