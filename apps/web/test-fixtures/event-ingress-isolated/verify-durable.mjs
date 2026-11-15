import assert from 'node:assert/strict';

export function verifyDurable({ postgres, prefix, alpha, page }) {
  const rows = postgres(`
    SELECT external_event_id || '|' || merchant_id || '|' || trust_level || '|' ||
      (EXISTS (SELECT 1 FROM pgmq.q_domain_events q WHERE q.msg_id = l.queue_message_id AND q.message = l.envelope))::text
    FROM public.domain_event_ledger l WHERE external_event_id LIKE '${prefix}-%'
    ORDER BY external_event_id;
  `).split('\n');
  assert.deepEqual(
    rows,
    ['alias', 'anonymous', 'custom', 'durable', 'page-path', 'referer'].map(
      (label) =>
        `${prefix}-${label}|${alpha}|${label === 'anonymous' ? 'anonymous_client' : 'tenant_verified_client'}|true`
    )
  );
  assert.equal(
    postgres(`
    SELECT envelope #>> '{data,delivery_user_data,fbp}'
    FROM public.domain_event_ledger WHERE external_event_id = '${page.event_id}';
  `),
    'synthetic-fbp',
    'cookie is preserved in original durable delivery context'
  );
}
