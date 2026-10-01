import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildRemediationReport,
  sendRemediationReportEmail,
} from './remediation-report.mjs';

describe('remediation report', () => {
  it('builds a concise operator report', () => {
    const report = buildRemediationReport({
      mode: 'dry-run',
      candidates: [
        {
          caseId: 'sentry:sentry_issue:abc123',
          category: 'sentry_issue',
          draftPr: { url: 'https://example.test/pull/12' },
          history: [{ type: 'prompt_written' }],
          occurrences: 4,
          recurrenceCount: 1,
          status: 'pr_open',
          firstSeen: '2026-05-19T10:00:00.000Z',
          lastSeen: '2026-05-19T10:05:00.000Z',
          sample: {
            route: '/api/products',
            message: 'customer@example.test',
            deploymentId: 'dpl_123',
            issueId: '987654321',
          },
        },
      ],
      actions: [{ type: 'prompt_written', path: '/tmp/prompt.md' }],
      policy: { allowed: false, reasons: ['dry run'] },
    });

    assert.match(report.subject, /Baci production-error-remediator/);
    assert.match(report.text, /case=sentry:sentry_issue:abc123/);
    assert.match(report.text, /lifecycle=pr_open/);
    assert.match(report.text, /priorOutcomes=prompt_written/);
    assert.match(report.text, /prompt_written/);
    assert.doesNotMatch(report.html, /customer@example\.test/);
    assert.doesNotMatch(report.text, /customer@example\.test/);
  });

  it('does not put raw action details in an operator report', () => {
    const report = buildRemediationReport({
      actions: [
        {
          detail: 'provider payload opaque-incident-detail-123',
          type: 'autofix_failed',
        },
      ],
    });

    assert.match(report.text, /autofix_failed/);
    assert.doesNotMatch(report.text, /opaque-incident-detail-123/);
    assert.doesNotMatch(report.html, /opaque-incident-detail-123/);
  });

  it('withholds a non-HTTPS draft PR URL from reports', () => {
    const report = buildRemediationReport({
      candidates: [{ draftPr: { url: 'javascript:alert(1)' } }],
    });

    assert.doesNotMatch(report.text, /javascript:alert/);
    assert.doesNotMatch(report.html, /javascript:alert/);
  });

  it('bounds an accepted HTTPS draft PR URL', () => {
    const report = buildRemediationReport({
      candidates: [
        { draftPr: { url: `https://example.test/${'x'.repeat(600)}` } },
      ],
    });

    assert.match(report.text, /https:\/\/example\.test\/x{100}/);
    assert.doesNotMatch(report.text, /x{501}/);
  });

  it('skips email when notification env is incomplete', async () => {
    const result = await sendRemediationReportEmail({
      report: { subject: 'Subject', text: 'Text', html: '<p>Text</p>' },
      env: {},
      fetchFn: () => {
        throw new Error('should not send');
      },
    });

    assert.deepEqual(result, { skipped: true, reason: 'email not configured' });
  });

  it('treats a whitespace-only ZeptoMail token as unconfigured', async () => {
    const result = await sendRemediationReportEmail({
      report: { subject: 'Subject', text: 'Text', html: '<p>Text</p>' },
      env: {
        BACI_REMEDIATION_NOTIFY_EMAILS: 'owner@example.com',
        ZEPTOMAIL_TOKEN: '   ',
      },
      fetchFn: () => {
        throw new Error('should not send');
      },
    });

    assert.deepEqual(result, { skipped: true, reason: 'email not configured' });
  });

  it('sends email through ZeptoMail when configured', async () => {
    const calls = [];
    const result = await sendRemediationReportEmail({
      report: { subject: 'Subject', text: 'Text', html: '<p>Text</p>' },
      env: {
        BACI_REMEDIATION_NOTIFY_EMAILS: 'owner@example.com,ops@example.com',
        ZEPTOMAIL_TOKEN: 'token',
        ZEPTOMAIL_FROM_DOMAIN: 'usebaci.com',
      },
      fetchFn: (url, init) => {
        calls.push({ url, init });
        return new Response('{}', { status: 200 });
      },
    });

    assert.deepEqual(result, { skipped: false, recipients: 2 });
    assert.equal(calls[0].url, 'https://api.zeptomail.com/v1.1/email');
    assert.equal(calls[0].init.headers.Authorization, 'Zoho-enczapikey token');
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.to.length, 2);
    assert.equal(body.from.address, 'notifications@usebaci.com');
  });

  it('does not duplicate the scheme on a canonical ZeptoMail token', async () => {
    let authorization = '';
    await sendRemediationReportEmail({
      report: { subject: 'Subject', text: 'Text', html: '<p>Text</p>' },
      env: {
        BACI_REMEDIATION_NOTIFY_EMAILS: 'owner@example.com',
        ZEPTOMAIL_TOKEN: 'Zoho-enczapikey production-token',
      },
      fetchFn: (_url, init) => {
        authorization = init.headers.Authorization;
        return new Response('{}', { status: 200 });
      },
    });

    assert.equal(authorization, 'Zoho-enczapikey production-token');
  });

  it('aborts a ZeptoMail request that exceeds the configured timeout', async () => {
    let receivedSignal;
    await assert.rejects(
      sendRemediationReportEmail({
        env: {
          BACI_REMEDIATION_NOTIFY_EMAILS: 'owner@example.com',
          ZEPTOMAIL_TOKEN: 'token',
        },
        fetchFn: (_url, init) => {
          receivedSignal = init.signal;
          return new Promise((_resolve, reject) => {
            receivedSignal.addEventListener(
              'abort',
              () => reject(new Error('request aborted')),
              { once: true }
            );
          });
        },
        report: { subject: 'Subject', text: 'Text', html: '<p>Text</p>' },
        timeoutMs: 1,
      }),
      /timed out/
    );
    assert.equal(receivedSignal.aborted, true);
  });

  it('uses only an HTTP status when ZeptoMail rejects a report', async () => {
    const stripeLikeToken = ['sk', 'live', 'abcdefghijklmnopqrstuvwxyz'].join(
      '_'
    );
    const providerBody = `customer@example.test Authorization: Bearer ${stripeLikeToken}`;

    await assert.rejects(
      sendRemediationReportEmail({
        report: { subject: 'Subject', text: 'Text', html: '<p>Text</p>' },
        env: {
          BACI_REMEDIATION_NOTIFY_EMAILS: 'owner@example.com',
          ZEPTOMAIL_TOKEN: 'token',
        },
        fetchFn: () => new Response(providerBody, { status: 503 }),
      }),
      (error) => {
        assert.equal(error.message, 'ZeptoMail report failed with HTTP 503');
        assert.doesNotMatch(error.message, /customer@example\.test/);
        assert.equal(error.message.includes(stripeLikeToken), false);
        return true;
      }
    );
  });

  it('cancels a rejected ZeptoMail response body before reporting its status', async () => {
    let cancellations = 0;

    await assert.rejects(
      sendRemediationReportEmail({
        report: { subject: 'Subject', text: 'Text', html: '<p>Text</p>' },
        env: {
          BACI_REMEDIATION_NOTIFY_EMAILS: 'owner@example.com',
          ZEPTOMAIL_TOKEN: 'token',
        },
        fetchFn: () => ({
          body: { cancel: async () => (cancellations += 1) },
          ok: false,
          status: 503,
        }),
      }),
      /ZeptoMail report failed with HTTP 503/
    );

    assert.equal(cancellations, 1);
  });
});
