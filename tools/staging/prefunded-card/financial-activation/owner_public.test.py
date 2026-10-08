import unittest

import owner_public as public


class PublicOwnerTests(unittest.TestCase):
    def test_authenticated_disabled_capability_is_proven_before_valid_denial_probes(self):
        calls = []

        def send(method,path,headers,body=None):
            calls.append((method,body))
            if method == 'GET':
                return 200,{'goalId':public.GOAL,'enabled':False,'maximumAmountKobo':0,'currency':'NGN'}
            return 503,{'error':'First-card savings checkout unavailable',
                        'code':'PREFUNDED_CARD_CHECKOUT_UNAVAILABLE'}

        result=public.verify(send=send,auth=lambda **kwargs: {'Authorization':'Bearer private'}, artifacts=lambda: True)
        self.assertFalse(result['mutationsEnabled'])
        self.assertEqual([method for method,body in calls],['GET','POST','PATCH'])
        self.assertEqual(calls[1][1]['amountKobo'],10000)

    def test_enabled_capability_or_401_refuses_without_mutation_probe(self):
        for status,enabled in ((200,True),(401,False)):
            calls=[]

            def send(method,path,headers,body=None):
                calls.append(method)
                return status,{'goalId':public.GOAL,'enabled':enabled,'maximumAmountKobo':0,'currency':'NGN'}

            with self.subTest(status=status,enabled=enabled),self.assertRaisesRegex(ValueError,'readonly_required'):
                public.verify(send=send,auth=lambda **kwargs: {}, artifacts=lambda: True)
            self.assertEqual(calls,['GET'])

    def test_foreign_secret_path_refuses(self):
        with self.assertRaisesRegex(ValueError,'fixture_scope_refused'):
            public.root_fixture('/etc/production-secret')

    def test_unproved_artifact_never_authenticates_or_sends_mutation_probe(self):
        from unittest.mock import Mock
        auth = Mock()
        with self.assertRaisesRegex(ValueError, 'artifacts_unproved'):
            public.verify(auth=auth)
        auth.assert_not_called()


if __name__=='__main__':
    unittest.main()
