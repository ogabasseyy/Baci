import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ValidateFunction } from 'ajv';
import type { ConnectorErrorCode } from '../../src/lib/connector/errors';
import type { HarnessSql } from '../connector-harness/gateway';
import type { GatewayConfig } from './config';

export interface GatewayRequestContext {
  request: IncomingMessage;
  response: ServerResponse;
  config: GatewayConfig;
  sql: HarnessSql;
  presented: string | null;
  url: URL;
  started: number;
  validators: Map<string, ValidateFunction>;
  audit(input: {
    grantId: string | null;
    route: string;
    status: number;
    started: number;
  }): Promise<void>;
  sendError(
    response: ServerResponse,
    status: number,
    error: string,
    code: ConnectorErrorCode,
    headers?: Record<string, string>
  ): void;
}
