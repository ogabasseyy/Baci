import json
import re


GUARDS = {
    'owner': ('  IF NOT EXISTS', 'checkout retirement owner denied', (
        'not-superuser', 'session-or-isolation-mismatch', 'approval-not-object')),
    'scope': ('  IF intent.id', 'checkout retirement scope denied', (
        'intent-operation-or-integration-mismatch', 'merchant-or-treasury-mismatch',
        'business-or-database-identity-mismatch', 'database-or-login-mismatch',
        'approved-integration-or-merchant-mismatch', 'approved-business-or-deadline-mismatch',
        'approved-customer-or-actor-mismatch', 'approved-goal-or-amount-mismatch',
        'approved-reference-or-fingerprint-mismatch', 'operation-integration-or-merchant-mismatch',
        'operation-customer-or-goal-mismatch', 'operation-treasury-or-amount-mismatch',
        'currency-mismatch', 'operation-references-mismatch', 'operation-fingerprint-mismatch',
        'operator-approval-mismatch', 'provider-result-mismatch', 'provider-http-mismatch',
        'configuration-hash-invalid')),
    'state': ('  IF clock_timestamp()', 'checkout retirement state advanced', (
        'provider-evidence-not-fresh', 'evidence-time-missing-or-intent-not-pending',
        'checkout-session-or-collection-present', 'initialization-claim-present',
        'collection-advanced-or-retired', 'transfer-attempted-or-fenced',
        'transfer-evidence-or-projection-present', 'collection-attempted-or-fenced',
        'verification-lease-active', 'dispatch-lease-active', 'saved-card-present',
        'authorization-binding-present', 'provider-alias-present', 'projection-present',
        'ledger-entry-present', 'reservation-insufficient')),
}
STEPS = {
    'scope-validation': '  PERFORM prefunded_card.checkout_validate_scope(scope,true);',
    'binding-lock': '  SELECT * INTO STRICT binding',
    'intent-lock': '  SELECT * INTO STRICT intent',
    'operation-lock': '  SELECT * INTO STRICT operation',
    'retirement-audit-read': '  SELECT approval INTO saved',
    'retirement-audit-insert': '  INSERT INTO prefunded_card.checkout_retirements',
    'operation-update': '  UPDATE prefunded_card.operations SET',
    'intent-update': '  UPDATE prefunded_card.checkout_intents SET',
    'reservation-update': '  UPDATE prefunded_card.treasury_bindings SET',
    'dispatch-update': '  UPDATE prefunded_card.dispatch_queue SET',
}
REASONS = {
    'checkout retirement owner denied': 'owner-denied',
    'first-card checkout scope denied': 'scope-validation-denied',
    'checkout retirement scope denied': 'scope-mismatch',
    'checkout retirement replay conflict': 'retirement-replay-conflict',
    'checkout retirement state advanced': 'state-advanced',
    'operation retirement transition denied': 'operation-trigger-denied',
    'checkout retirement transition denied': 'intent-trigger-denied',
    'retired checkout cannot advance': 'retired-operation-trigger-denied',
    'prefunded treasury binding identity immutable': 'treasury-identity-trigger-denied',
    'prefunded treasury binding reenable denied': 'treasury-enable-trigger-denied',
}


def annotate_state(sql, directory):
    source = (directory / 'checkout-retirement-apply.sql').read_text()
    if sql.count(source) != 1:
        raise ValueError('Reviewed retirement body required')
    annotated = source
    for group, (start, message, labels) in GUARDS.items():
        end = "    RAISE EXCEPTION '" + message + "'"
        if source.count(start) != 1 or source.count(end) != 1:
            raise ValueError('Reviewed retirement guard differs')
        block = source[source.index(start):source.index(end)]
        if not block.startswith('  IF ') or not block.endswith(' THEN\n'):
            raise ValueError('Reviewed retirement condition differs')
        conditions = block.removeprefix('  IF ').removesuffix(' THEN\n').split('\n    OR ')
        if len(conditions) != len(labels):
            raise ValueError('Reviewed retirement condition count differs')
        values = ','.join(f"('{label}',({condition.replace(chr(10), ' ')}))"
                          for label, condition in zip(labels, conditions))
        notice = ("  RAISE NOTICE 'BACI_RETIREMENT_GUARD:%', "
                  f"jsonb_build_object('group','{group}','failedConditions',"
                  f"(SELECT coalesce(jsonb_agg(label),'[]'::jsonb) FROM (VALUES {values}) "
                  "checks(label,failed) WHERE failed IS TRUE));\n")
        annotated = annotated.replace(end, notice + end, 1)
    for label, token in STEPS.items():
        expected = 2 if label == 'scope-validation' else 1
        if source.count(token) != expected:
            raise ValueError('Reviewed retirement step differs')
        for position in range(expected):
            actual_label = 'final-scope-validation' if position else label
            marker = f"  RAISE NOTICE 'BACI_RETIREMENT_STEP:{actual_label}';\n"
            occurrence = annotated.find(token)
            if position:
                occurrence = annotated.find(token, occurrence + len(token))
            annotated = annotated[:occurrence] + marker + annotated[occurrence:]
    return sql.replace(source, annotated, 1)


def safe_details(stderr):
    report = {}
    for line in stderr.splitlines():
        notice = re.fullmatch(r'NOTICE:\s+(?:00000:\s+)?BACI_RETIREMENT_(STEP|GUARD):(.*)', line)
        if notice and notice[1] == 'STEP' and notice[2] in {*STEPS, 'final-scope-validation'}:
            report['retirementStep'] = notice[2]
        elif notice and notice[1] == 'GUARD':
            try:
                value = json.loads(notice[2])
                if (isinstance(value, dict) and set(value) == {'group', 'failedConditions'}
                        and isinstance(value['group'], str) and value['group'] in GUARDS
                        and isinstance(value['failedConditions'], list)
                        and all(isinstance(label, str) and label in GUARDS[value['group']][2]
                                for label in value['failedConditions'])):
                    report['guard'] = value
            except (ValueError, TypeError):
                pass
        error = re.fullmatch(r'ERROR:\s+42501:\s+(.+)', line)
        if error and error[1] in REASONS:
            report['refusalReason'] = REASONS[error[1]]
    return report
