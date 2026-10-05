// @vitest-environment node
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { sendUnexpectedError } from './connector-http';

describe('unexpected connector failures', () => {
  it('returns a safe 500 before headers are sent', () => {
    const response = new ServerResponse(new IncomingMessage(new Socket()));
    const end = vi.spyOn(response, 'end');
    sendUnexpectedError(response);
    expect(response.statusCode).toBe(500);
    expect(end).toHaveBeenCalledWith(
      expect.stringContaining('UNKNOWN_OUTCOME')
    );
  });

  it('closes an existing response rather than sending headers twice', () => {
    const response = new ServerResponse(new IncomingMessage(new Socket()));
    response.writeHead(200);
    const writeHead = vi.spyOn(response, 'writeHead');
    const destroy = vi.spyOn(response, 'destroy');
    sendUnexpectedError(response);
    expect(writeHead).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledOnce();
  });
});
