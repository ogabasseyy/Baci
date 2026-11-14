import { afterEach, describe, expect, it, vi } from 'vitest';
import { logZeptoMailSendFailure } from './zeptomail-error-log';

const failure = {
  message: 'Recipient secret@example.com rejected',
  code: 'TM_4001',
  details: [{ target: 'secret@example.com' }],
};

describe('logZeptoMailSendFailure', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs the full failure when redaction is off', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    logZeptoMailSendFailure(failure, false);

    expect(consoleError).toHaveBeenCalledWith(
      'ZeptoMail email error:',
      JSON.stringify(failure)
    );
  });

  it('logs only the error code when redaction is on', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    logZeptoMailSendFailure(failure, true);

    expect(consoleError).toHaveBeenCalledWith(
      'ZeptoMail email error:',
      'TM_4001'
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      'secret@example.com'
    );
  });

  it('logs "unknown" when a redacted failure has no code', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    logZeptoMailSendFailure({ message: 'boom' }, true);

    expect(consoleError).toHaveBeenCalledWith(
      'ZeptoMail email error:',
      'unknown'
    );
  });
});
