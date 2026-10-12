SEAL = 'c78ef2d125ad8019508cfced9e19d730848184c528b7a33c68d42c782418b086'
SYSTEM = '7685292944002592802'
BINDING = 'ffffcb16-2e95-5cff-a591-e9cc81cf5f57'
GOAL = '430314fd-cd8b-4579-98d4-e9f345713dd6'
INTENT = 'd8bcf921-61b3-4647-90e2-5648e4d6967d'
VERIFIER = 'prefunded_snapshot_verifier'
TABLES = (
    'prefunded_card.checkout_intents', 'prefunded_card.operations',
    'prefunded_card.checkout_retirements', 'prefunded_card.treasury_bindings',
    'prefunded_card.treasury_identities', 'prefunded_card.treasury_replenishments',
    'prefunded_card.credit_routes', 'prefunded_card.provider_evidence',
    'prefunded_card.inflow_attributions', 'prefunded_card.evidence_conflicts',
    'prefunded_card.projections', 'prefunded_card.bank_projections',
    'piggyvest_savings_ledger.bindings', 'piggyvest_savings_ledger.operations',
    'piggyvest_savings_ledger.postings', 'piggyvest_staging.wallet_goal_mappings',
    'piggyvest_staging.goal_inflow_projections', 'public.customer_savings_contributions',
    'public.piggyvest_inflow_credits', 'public.customers', 'piggyvest_staging.integrations',
)
FUNCTIONS = {
    'prefunded_card.record_treasury_snapshot(uuid,text,bigint,timestamp with time zone,bigint)':
        '59b1cf11108a2f7c22d029655e9a1d7c6480a9caa74919d7c30379bb408705b0',
    'prefunded_card.record_scoped_treasury_snapshot(uuid,text,timestamp with time zone,bigint)':
        'cc9c150f1fc5c9cd1708d6756bfe1e66203cc6800129d14903b7d5ef0f2aca63',
}
DEFINITIONS = {
    'prefunded_card.record_treasury_snapshot(uuid,text,bigint,timestamp with time zone,bigint)':
        '35c31d1abbea778d44171f39fb6e38cb75bc2ffed47ebe7221eb77cbfcb0cda4',
    'prefunded_card.record_scoped_treasury_snapshot(uuid,text,timestamp with time zone,bigint)':
        '9d061b1e8695477e48e9810de0d9286ddc5b5495e4ceecb2374eb4bb761bd202',
}
MODULES = {
    'protected_snapshot': 'tooling/financial-activation/protected_snapshot.py',
    'database_sql': 'tooling/card-week-renewal/database_sql.py',
    'source_functions': 'tooling/card-week-renewal/source_functions.py',
}
BINDING_FIELDS = {'id', 'integration_id', 'merchant_id', 'expected_business_id',
    'source_wallet_id', 'currency', 'verified_available_kobo', 'reserved_kobo',
    'consumed_kobo', 'verified_at', 'authorized_login', 'enabled'}
SNAPSHOT_FIELDS = {'treasury_binding_id', 'evidence_id', 'sequence_number', 'observed_at',
                   'available_kobo', 'verified_by', 'verified_at'}
FINANCIAL_FIELDS = {'goal', 'intent', 'operation', 'retirementAudits', 'treasuryBinding',
                    'treasuryIdentity', 'replenishments', 'otherIntentCount', 'otherOperationCount'}
SECURITY_FIELDS = {'schemas', 'relations', 'columns', 'policies', 'triggers',
    'constraints', 'indexes', 'routines', 'roles', 'memberships', 'types', 'enums',
    'ranges', 'rules', 'defaultAcls'}
