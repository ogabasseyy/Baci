from hashlib import sha256


class EvidenceRefresh:
    def __init__(self, actions):
        self.actions = actions

    def run(self, apply=False):
        actions = self.actions
        actions.guard()
        actions.stopped()
        candidate = actions.collect()
        actions.validate(candidate)
        actions.guard()
        if not apply:
            return {'status': 'fresh-evidence-preflight-only', 'applied': False,
                    'candidateSha256': sha256(candidate).hexdigest()}
        actions.backup(candidate)
        replaced_attempted = False
        start_attempted = False
        try:
            actions.guard()
            actions.validate(candidate)
            replaced_attempted = True
            actions.replace(candidate)
            actions.guard()
            start_attempted = True
            actions.start()
            actions.verify()
            actions.guard()
            return {'status': 'fresh-evidence-applied', 'applied': True,
                    'candidateSha256': sha256(candidate).hexdigest(), 'unauthenticated401Verified': True}
        except Exception:
            try:
                if start_attempted:
                    actions.stop()
                if replaced_attempted:
                    actions.restore(candidate)
            except Exception:
                raise ValueError('refresh_rollback_failed_operator_required') from None
            raise ValueError('refresh_failed_gateway_not_restarted') from None
