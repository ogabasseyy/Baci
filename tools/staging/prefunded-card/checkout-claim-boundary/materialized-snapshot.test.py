import importlib.util
from pathlib import Path
import unittest


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('materialized_fixture', HERE / 'materialized_pg17_fixture.py')
FIXTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURE)


class MaterializedSnapshotTests(FIXTURE.MaterializedPg17Fixture):
    def test_postgresql_17_hashes_every_populated_materialized_row(self):
        evidence = self.snapshot()
        self.assertEqual(evidence['unsupportedRelations'], [])
        row = evidence['tableRows']['public.mv_populated']
        self.assertEqual(row['count'], 1)
        self.assertEqual(row['kind'], 'm')
        self.assertTrue(row['populated'])
        self.assertEqual(row['owner'], 'postgres')
        self.assertEqual(row['ownerOid'], evidence['identity']['roleOid'])

    def test_unpopulated_has_a_distinct_hashed_marker_not_silently_omitted_data(self):
        evidence = self.snapshot()
        rows = evidence['tableRows']
        self.assertFalse(rows['public.mv_unpopulated']['populated'])
        self.assertEqual(rows['public.mv_unpopulated']['count'], 0)
        self.assertNotEqual(rows['public.mv_unpopulated']['sha256'], rows['public.mv_empty']['sha256'])
        self.assertEqual(rows, self.snapshot()['tableRows'])

    def test_full_materialized_contents_are_hashed_not_only_counts_or_selected_columns(self):
        self.sql('CREATE MATERIALIZED VIEW public.mv_other AS SELECT 1::integer id,10001::bigint amount;')
        rows = self.snapshot()['tableRows']
        self.assertEqual(rows['public.mv_other']['count'], rows['public.mv_populated']['count'])
        self.assertNotEqual(rows['public.mv_other']['sha256'], rows['public.mv_populated']['sha256'])


if __name__ == '__main__':
    unittest.main()
