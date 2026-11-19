import { describe, expect, it } from 'vitest';
import { ResponseCapture } from './response-capture';
import { HarnessRefusal } from './safety-guards';

const response = {
  method: 'GET',
  pathname: '/api/v1/wallet/x',
  httpStatus: 200,
  envelope: { status: true },
};

describe('ResponseCapture', () => {
  it('is empty before anything is recorded', () => {
    expect(new ResponseCapture().take()).toEqual({
      response: null,
      refusal: null,
    });
  });

  it('keeps only the latest response', () => {
    const capture = new ResponseCapture();
    capture.record(response);
    capture.record({ ...response, httpStatus: 404, envelope: null });
    expect(capture.take().response).toMatchObject({
      httpStatus: 404,
      envelope: null,
    });
  });

  it('remembers a guard refusal so a wrapping client cannot swallow it', () => {
    const capture = new ResponseCapture();
    const refusal = new HarnessRefusal('HOST_NOT_ALLOWED');
    capture.recordRefusal(refusal);
    expect(capture.take().refusal).toBe(refusal);
  });

  it('take() clears both slots so one call never sees the previous call', () => {
    const capture = new ResponseCapture();
    capture.record(response);
    capture.recordRefusal(new HarnessRefusal('HOST_NOT_ALLOWED'));
    capture.take();
    expect(capture.take()).toEqual({ response: null, refusal: null });
  });

  it('reset() discards a pending response and refusal', () => {
    const capture = new ResponseCapture();
    capture.record(response);
    capture.recordRefusal(new HarnessRefusal('HOST_NOT_ALLOWED'));
    capture.reset();
    expect(capture.take()).toEqual({ response: null, refusal: null });
  });

  it('can hold a refusal and a response at once (the refusal wins for callers)', () => {
    const capture = new ResponseCapture();
    capture.record(response);
    capture.recordRefusal(new HarnessRefusal('RECORDING_ACCOUNT'));
    const taken = capture.take();
    expect(taken.refusal?.code).toBe('RECORDING_ACCOUNT');
    expect(taken.response).not.toBeNull();
  });
});
