import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ValidateFunction } from 'ajv';
import type { ConnectorErrorCode } from '../../src/lib/connector/errors';
import type { HarnessConfig } from './config';
import type { HarnessSql } from './gateway';
export interface HarnessRequestContext {
  request: IncomingMessage;
  response: ServerResponse;
  config: HarnessConfig;
  sql: HarnessSql;
  url: URL;
  started: number;
  validators: Map<string, ValidateFunction>;
  audit(entry: Record<string, unknown>): void;
  sendError(
    response: ServerResponse,
    status: number,
    error: string,
    code?: ConnectorErrorCode
  ): void;
}
