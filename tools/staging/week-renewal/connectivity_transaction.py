def execute(actions):
    actions.stage = 'preflight'
    actions.preflight()
    try:
        for stage in ('stop', 'rehearse_role', 'bind_role', 'install', 'arm_deadlines',
                      'fresh_evidence', 'start', 'verify'):
            actions.stage = stage
            getattr(actions, stage)()
        actions.stage = 'finish'
        return actions.finish()
    except BaseException:
        actions.stage = 'recovery'
        actions.recover()
        raise
