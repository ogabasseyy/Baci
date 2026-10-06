import json
import os
import subprocess
import unittest
import uuid
from unittest.mock import patch

import phone_email_contract as contract


@unittest.skipUnless(os.environ.get('BACI_EMAIL_TEST_DB_CONTAINER'), 'Set an explicitly local test PostgreSQL container')
class EmailSqlTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        container = os.environ['BACI_EMAIL_TEST_DB_CONTAINER']
        if container != 'supabase_db_baci-redvault-local':
            raise RuntimeError('Only the explicitly local scratch host is allowed')
        cls.database = 'email_rehearsal_' + uuid.uuid4().hex
        cls.prefix = ['docker', 'exec', '-i', container, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres']
        cls.sql('CREATE DATABASE ' + cls.database, 'postgres')
        cls.addClassCleanup(lambda: cls.sql('DROP DATABASE ' + cls.database, 'postgres'))
        cls.system = cls.sql('SELECT system_identifier FROM pg_control_system()').strip()
        cls.sql(f"""
          CREATE SCHEMA auth; CREATE SCHEMA prefunded_card;
          CREATE TABLE auth.users(id uuid,email text,encrypted_password text);
          CREATE TABLE auth.identities(user_id uuid,provider text,identity_data jsonb);
          CREATE TABLE public.customers(id uuid,merchant_id uuid,user_id uuid,email text);
          CREATE TABLE public.customer_savings_goals(id uuid,merchant_id uuid,customer_id uuid,
            current_amount numeric,target_amount numeric,status text);
          CREATE TABLE prefunded_card.checkout_intents(id uuid,operation_id uuid,email text,phase text,amount_kobo bigint,
            reference text,session_authorization_url text,verified_collection jsonb,customer_id uuid,merchant_id uuid);
          CREATE TABLE prefunded_card.operations(id uuid,collection_status text,collection_provider_transaction_id text,
            transfer_status text,projection_status text,amount_kobo bigint,customer_id uuid,merchant_id uuid);
          CREATE TABLE prefunded_card.treasury_bindings(id uuid,reserved_kobo bigint,consumed_kobo bigint,merchant_id uuid);
          INSERT INTO auth.users VALUES('{contract.ACTOR}','old@example.invalid','unchanged-hash');
          INSERT INTO auth.identities VALUES('{contract.ACTOR}','email','{{"email":"old@example.invalid"}}');
          INSERT INTO public.customers VALUES('{contract.CUSTOMER}','{contract.MERCHANT}','{contract.ACTOR}','old@example.invalid');
          INSERT INTO public.customer_savings_goals VALUES('{contract.GOAL}','{contract.MERCHANT}','{contract.CUSTOMER}',100,250000,'active');
          INSERT INTO prefunded_card.checkout_intents VALUES('{contract.GOAL}','{contract.GOAL}','old@example.invalid','pending',10000,
            'unmodified-reference',NULL,NULL,'{contract.CUSTOMER}','{contract.MERCHANT}');
          INSERT INTO prefunded_card.operations VALUES('{contract.GOAL}','pending',NULL,'not_started','unapplied',10000,
            '{contract.CUSTOMER}','{contract.MERCHANT}');
          INSERT INTO prefunded_card.treasury_bindings VALUES('{contract.GOAL}',10000,0,'{contract.MERCHANT}');
        """)

    @classmethod
    def sql(cls, command, database=None):
        result = subprocess.run([*cls.prefix, '-d', database or cls.database], input=command, text=True,
                                capture_output=True, timeout=30)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout

    def test_sql_preserves_pending_attempt_and_money_on_scoped_email_change(self):
        with patch.object(contract, 'SYSTEM', self.system), patch.object(contract, 'DEADLINE_EPOCH', 2000000000), \
             patch.object(contract, 'OLD_EMAIL_SHA', contract.digest(b'old@example.invalid')):
            snapshot = contract.snapshot_sql().replace("current_database()='postgres'", 'true')
            update = contract.customer_update_sql().replace("current_database()<>'postgres'", 'false')
            before = json.loads(self.sql(snapshot))
            contract.validate(before)
            with self.assertRaises(RuntimeError):
                self.sql(update)
            self.sql(f"UPDATE auth.users SET email='{contract.EMAIL}' WHERE id='{contract.ACTOR}'; "
                     f"UPDATE auth.identities SET identity_data='{{\"email\":\"{contract.EMAIL}\"}}' WHERE user_id='{contract.ACTOR}';")
            self.sql(update)
            self.sql(update)
            after = json.loads(self.sql(snapshot))
            contract.validate(after, before['protected'], final=True)
            self.assertEqual(self.sql('SELECT email FROM prefunded_card.checkout_intents').strip(), 'old@example.invalid')
            self.assertEqual(self.sql('SELECT reserved_kobo FROM prefunded_card.treasury_bindings').strip(), '10000')


if __name__ == '__main__':
    unittest.main()
