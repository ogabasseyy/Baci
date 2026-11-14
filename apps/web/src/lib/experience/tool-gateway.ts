import type { BuilderIdentity } from '@/lib/builder-connector/types';
import { createBuilderThrottle } from '@/lib/builder-gateway/throttle';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import {
  experienceError,
  experienceToolResult,
} from '@/schemas/experience-tool-results';
import {
  type ExperienceToolName,
  experienceToolInputs,
  isExperienceTool,
} from '@/schemas/experience-tools';
import { experienceToolPolicy } from './tool-policy';
export function createExperienceGateway(deps: {
  authenticate(request: Request): Promise<BuilderIdentity>;
  execute(
    identity: BuilderIdentity,
    name: ExperienceToolName,
    input: unknown
  ): Promise<unknown>;
}) {
  const limit = createBuilderThrottle({ perUser: 60, perConnection: 30 });
  return async (request: Request, name: string) => {
    const send = (value: unknown, status = 200) =>
      Response.json(value, {
        status,
        headers: {
          'Cache-Control': 'no-store',
          ...(status === 401 || status === 403
            ? {
                'WWW-Authenticate': `Bearer resource_metadata="https://mcp.usebaci.com/.well-known/oauth-protected-resource/builder/mcp", scope="${isExperienceTool(name) ? experienceToolPolicy[name].scopes.join(' ') : 'storefront.read'}", error="${status === 403 ? 'insufficient_scope' : 'invalid_token'}"`,
              }
            : {}),
        },
      });
    if (!isExperienceTool(name)) return send(experienceError('NOT_FOUND'), 404);
    if (
      request.method !== 'POST' ||
      !request.headers
        .get('content-type')
        ?.toLowerCase()
        .startsWith('application/json')
    )
      return send(experienceError('INVALID_REQUEST'), 400);
    if (
      !/^Bearer [A-Za-z0-9_.-]{1,8192}$/i.test(
        request.headers.get('authorization') ?? ''
      )
    )
      return send(experienceError('CONNECTION_REVOKED'), 401);
    let identity: BuilderIdentity;
    try {
      identity = await deps.authenticate(request);
    } catch {
      return send(experienceError('CONNECTION_REVOKED'), 401);
    }
    if (experienceToolPolicy[name].scopes.some((s) => !identity.scopes.has(s)))
      return send(experienceError('INSUFFICIENT_SCOPE'), 403);
    if (!limit(identity)) return send(experienceError('RATE_LIMITED'), 429);
    const body = await readBoundedJsonBody(request, 65536);
    if (!body.ok)
      return send(
        experienceError('INVALID_REQUEST'),
        body.reason === 'too_large' ? 413 : 400
      );
    const parsed = experienceToolInputs[name].safeParse(body.body);
    if (!parsed.success) return send(experienceError('INVALID_REQUEST'), 400);
    try {
      const result = experienceToolResult.safeParse(
        await deps.execute(identity, name, parsed.data)
      );
      if (
        !result.success ||
        Buffer.byteLength(JSON.stringify(result.data)) > 98304
      )
        return send(experienceError('UNAVAILABLE'), 502);
      return send(result.data);
    } catch {
      return send(experienceError('UNAVAILABLE'), 500);
    }
  };
}
