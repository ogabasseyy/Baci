import { builderError } from '@/lib/builder-connector/errors';
import {
  builderAuthChallenge,
  builderToolPolicy,
} from '@/lib/builder-connector/tool-policy';
import type { BuilderIdentity } from '@/lib/builder-connector/types';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import { DraftServiceError } from '@/lib/website-builder/mutation-authorization';
import {
  type ImplementedBuilderTool,
  isImplementedBuilderTool,
} from '@/schemas/builder-implemented-tools';
import {
  BUILDER_REQUEST_BYTES,
  parseBuilderRequest,
} from '@/schemas/builder-mcp';
import { builderOutputSchemas } from '@/schemas/builder-mcp-results';
import {
  type GatewayAuditEntry,
  toAuditEntry,
} from '../../../tools/connector-gateway/audit';
import { createBuilderThrottle } from './throttle';
export interface BuilderGatewayDependencies {
  authenticate: (request: Request) => Promise<BuilderIdentity>;
  execute: (
    identity: BuilderIdentity,
    tool: ImplementedBuilderTool,
    input: unknown
  ) => Promise<unknown>;
  audit?: (entry: GatewayAuditEntry) => void | Promise<void>;
  limits?: { perUser: number; perConnection: number };
}
export type BuilderGatewayHandler = (
  request: Request,
  tool: string
) => Promise<Response>;
export function createBuilderGateway(
  deps: BuilderGatewayDependencies
): BuilderGatewayHandler {
  const throttle = createBuilderThrottle(
    deps.limits ?? { perUser: 60, perConnection: 30 }
  );
  return async (request, tool) => {
    const started = Date.now();
    let identity: BuilderIdentity | undefined;
    const respond = (data: unknown, status = 200) => {
      const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
      if (status === 401 || status === 403)
        headers['WWW-Authenticate'] = builderAuthChallenge(
          status === 401 ? 'CONNECTION_REVOKED' : 'INSUFFICIENT_SCOPE',
          isImplementedBuilderTool(tool) ? tool : 'list_storefronts'
        )._meta['mcp/www_authenticate'][0];
      if (status === 429) headers['Retry-After'] = '60';
      // Best-effort request telemetry only; effects retain their transactional SQL evidence.
      try {
        void Promise.resolve(
          deps.audit?.(
            toAuditEntry({
              grantId: identity?.connectionId ?? null,
              route: isImplementedBuilderTool(tool)
                ? `builder/${tool}`
                : 'builder/unknown',
              status,
              latencyMs: Math.max(0, Date.now() - started),
            })
          )
        ).catch(() => undefined);
      } catch {
        /* Telemetry must not turn a committed effect into an apparent failure. */
      }
      return Response.json(data, { status, headers });
    };
    if (!isImplementedBuilderTool(tool))
      return respond(builderError('NOT_FOUND'), 404);
    const auth = request.headers.get('authorization');
    if (!auth || auth.length > 8192 || !/^Bearer [A-Za-z0-9_.-]+$/i.test(auth))
      return respond(builderError('CONNECTION_REVOKED'), 401);
    try {
      identity = await deps.authenticate(request);
    } catch {
      return respond(builderError('CONNECTION_REVOKED'), 401);
    }
    if (
      builderToolPolicy[tool].scopes.some(
        (scope) => !identity.scopes.has(scope)
      )
    )
      return respond(builderError('INSUFFICIENT_SCOPE'), 403);
    if (!throttle(identity)) return respond(builderError('RATE_LIMITED'), 429);
    if (
      request.method !== 'POST' ||
      !request.headers
        .get('content-type')
        ?.toLowerCase()
        .startsWith('application/json')
    )
      return respond(builderError('INVALID_REQUEST'), 400);
    const body = await readBoundedJsonBody(request, BUILDER_REQUEST_BYTES);
    if (!body.ok)
      return respond(
        builderError('INVALID_REQUEST'),
        body.reason === 'too_large' ? 413 : 400
      );
    const parsed = parseBuilderRequest(tool, JSON.stringify(body.body));
    if (!parsed.ok) return respond(parsed.error, 400);
    try {
      const data = builderOutputSchemas[tool].safeParse(
        await deps.execute(identity, tool, parsed.data)
      );
      const output = data.success
        ? data.data
        : builderError('OPERATION_FAILED');
      if (
        'code' in output &&
        (output.code === 'CONNECTION_REVOKED' ||
          output.code === 'INSUFFICIENT_SCOPE')
      )
        return respond(
          output,
          output.code === 'CONNECTION_REVOKED' ? 401 : 403
        );
      return respond(output);
    } catch (error) {
      const output =
        error instanceof DraftServiceError
          ? builderError(error.code)
          : builderError('OPERATION_FAILED');
      return respond(
        output,
        output.code === 'CONNECTION_REVOKED'
          ? 401
          : output.code === 'INSUFFICIENT_SCOPE'
            ? 403
            : 200
      );
    }
  };
}
