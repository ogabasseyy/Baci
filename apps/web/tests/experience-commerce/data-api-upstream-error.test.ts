// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { failCommerceUpstream } from './data-api';

it('terminates an interrupted upstream response without writing a second header', () => {
  const response = {
    headersSent: true,
    writeHead: vi.fn(() => {
      throw Error('ERR_HTTP_HEADERS_SENT');
    }),
    end: vi.fn(),
    destroy: vi.fn(),
  };
  expect(() => failCommerceUpstream(response)).not.toThrow();
  expect(response.destroy).toHaveBeenCalledOnce();
  expect(response.writeHead).not.toHaveBeenCalled();
  expect(response.end).not.toHaveBeenCalled();
});
it('responds with unavailable when an upstream fails before headers', () => {
  const response = {
    headersSent: false,
    writeHead: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
  };
  failCommerceUpstream(response);
  expect(response.writeHead).toHaveBeenCalledWith(503);
  expect(response.end).toHaveBeenCalledOnce();
  expect(response.destroy).not.toHaveBeenCalled();
});
