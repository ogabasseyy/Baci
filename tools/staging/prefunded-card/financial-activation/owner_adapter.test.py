from datetime import datetime, timezone
import unittest
from unittest.mock import patch

import owner_adapter as owner


class OwnerAdapterTests(unittest.TestCase):
    def test_replay_has_to_start_before_any_completed_pass_can_be_claimed(self):
        adapter=object.__new__(owner.FinancialOwnerAdapter);adapter.started_at=None
        with self.assertRaisesRegex(ValueError,'replay_not_started'):
            adapter.replay_completed_pass_is_fresh()

    def test_fresh_completed_replay_heartbeat_is_required(self):
        adapter=object.__new__(owner.FinancialOwnerAdapter);adapter.started_at=1790918000
        with patch.object(owner.time,'time',return_value=1790918002), \
                patch.object(owner,'inspect',return_value={'State':{'Running':True}}), \
                patch.object(owner,'command',return_value='1790918001000'):
            self.assertTrue(adapter.replay_completed_pass_is_fresh())

    def test_stopped_replay_is_not_treated_as_healthy(self):
        adapter=object.__new__(owner.FinancialOwnerAdapter);adapter.started_at=1790918000
        with patch.object(owner.time,'time',return_value=1790918002), \
                patch.object(owner,'inspect',return_value={'State':{'Running':False}}):
            with self.assertRaisesRegex(ValueError,'replay_stopped_or_expired'):
                adapter.replay_completed_pass_is_fresh()

    def test_successful_unit_state_without_fresh_container_invocation_refuses(self):
        adapter=object.__new__(owner.FinancialOwnerAdapter);adapter.passes={}
        with patch.object(owner,'command',return_value=''), \
                patch.object(owner,'properties',return_value={'Result':'success','ExecMainStatus':'0',
                                                            'ActiveState':'inactive'}), \
                patch.object(owner,'inspect',return_value={'State':{'Running':False,'ExitCode':0,
                                            'StartedAt':'2026-09-27T00:00:00Z'}}):
            with self.assertRaisesRegex(ValueError,'oneshot_not_fresh'):
                adapter.run_once('snapshot')
        self.assertEqual(adapter.passes,{})

    def test_scheduled_snapshot_and_background_passes_are_checked_from_actual_output(self):
        for kind,report in (('snapshot','{"outcome":"recorded"}'),('background','{"status":"completed"}')):
            adapter=object.__new__(owner.FinancialOwnerAdapter);adapter.passes={}
            with patch.object(owner,'command',return_value=report), \
                    patch.object(owner,'properties',return_value={'Result':'success','ExecMainStatus':'0',
                                                                'ActiveState':'inactive'}), \
                    patch.object(owner,'inspect',return_value={'State':{'Running':False,'ExitCode':0,
                                                'StartedAt':datetime.now(timezone.utc).isoformat()}}), \
                    patch.object(owner,'datetime',wraps=datetime) as clock:
                clock.now.return_value=datetime(2026,10,1,tzinfo=timezone.utc)
                adapter.run_once(kind)
            self.assertIn(kind,adapter.passes)

    def test_recorded_snapshot_alone_does_not_certify_background(self):
        adapter=object.__new__(owner.FinancialOwnerAdapter);adapter.passes={'snapshot':{'outcome':'recorded'}}
        self.assertTrue(adapter.snapshot_pass_verified())
        self.assertFalse(adapter.background_pass_verified())


if __name__=='__main__':
    unittest.main()
