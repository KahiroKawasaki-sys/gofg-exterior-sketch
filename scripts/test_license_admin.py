import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import license_admin as la  # noqa: E402


class LicenseAdminTest(unittest.TestCase):
    def test_key_format(self):
        for _ in range(50):
            k = la.new_key()
            self.assertRegex(k, r"^GS(-[A-HJKMNP-Z2-9]{4}){4}$")
            self.assertFalse(re.search(r"[01OIL]", k[3:]))

    def test_hash_matches_worker(self):
        # tests/worker-license.test.js と同じ期待値（worker/license.ts の hashKey）
        expected = "99ee8d01958ccfb107c7626be1c43896810eda13c4ae1b740fa461297aef6e83"
        self.assertEqual(la.key_hash("GS-ABCD-EFGH-JKMN-PQRS"), expected)
        self.assertEqual(la.key_hash("gs-abcd efgh-jkmn-pqrs"), expected)

    def test_new_sql_has_only_hash(self):
        args = la.argparse.Namespace(client="山田's外構", plan="pro", max_devices=5, expires="2027-03-31", render_limit=300, transcribe_min_limit=1200, note="")
        sql = la.sql_new(args, "GS-ABCD-EFGH-JKMN-PQRS")
        self.assertNotIn("ABCD", sql)
        self.assertIn(la.key_hash("GS-ABCD-EFGH-JKMN-PQRS"), sql)
        self.assertIn("'山田''s外構'", sql)
        self.assertIn(",5,", sql)


if __name__ == "__main__":
    unittest.main()
