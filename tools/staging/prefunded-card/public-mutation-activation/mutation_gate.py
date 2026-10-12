import time

from mutation_contract import enabled_capability, validate, window
from protected_snapshot import prove_unchanged
from release_contract import Refused, _require


def enable(adapter, now=time.time):
    window(now())
    with adapter.lock():
        adapter.verify_reviewed_inputs()
        evidence = adapter.collect()
        validate(evidence, adapter.seal_sha, adapter.baseline, now())
        adapter.record('preflight', evidence)
        attempted = False
        try:
            window(now())
            adapter.recheck(evidence)
            validate(evidence, adapter.seal_sha, adapter.baseline, now())
            window(now())
            adapter.record('enable-intent', adapter.transition())
            attempted = True
            adapter.replace_public()
            window(now())
            adapter.verify_enabled()
            enabled_capability(adapter.capability())
            prove_unchanged(adapter.baseline, adapter.snapshot())
            adapter.recheck_chain()
            window(now())
            report = {'status': 'public-mutation-gate-enabled', 'deadline': adapter.deadline,
                'sealSha256': adapter.seal_sha, 'mutationsEnabled': True,
                'paymentOutcome': 'not-tested', 'companyTotalBudgetKobo': 10000,
                'preservedPrincipalKobo': 10000, 'savedCardsEnabled': False,
                'autoDebitEnabled': False}
            adapter.record('enabled', report)
            return report
        except BaseException as activation_error:
            if attempted:
                try:
                    result = adapter.recover()
                    _require(result.get('status') in ('public-readonly-restored',
                        'public-stopped-deadline-expired'), 'public_mutation_recovery_unconfirmed')
                    adapter.record('recovery', result)
                except BaseException as recovery_error:
                    raise Refused('public_mutation_recovery_unconfirmed') from recovery_error
            raise activation_error
