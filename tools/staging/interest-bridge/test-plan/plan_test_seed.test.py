from pathlib import Path
import unittest


class PlanSeedContractTests(unittest.TestCase):
    def test_fixture_seed_explicitly_labels_synthetic_catalogue_and_does_not_insert_interest(self):
        root = Path(__file__).parent
        seed = (root / 'plan_test_seed.sql').read_text()
        database = (root / 'plan_test_database.sql').read_text()
        self.assertIn('Synthetic old funded goal', seed)
        self.assertIn('Synthetic phone', seed)
        self.assertIn('10000,0,0,true', seed)
        self.assertNotIn('interest_receipts', seed)
        self.assertNotIn('interest_allocations', seed)
        self.assertNotIn('CREATE EXTENSION', database)


if __name__ == '__main__':
    unittest.main()
