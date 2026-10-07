import unittest

from connectivity_listeners import validate_listeners
from renewal_contract import Refused


class ListenerTests(unittest.TestCase):
    def test_only_loopback_listeners_owned_by_the_two_main_processes_are_accepted(self):
        content = 'LISTEN 0 511 127.0.0.1:4792 0.0.0.0:* users:(("node",pid=101,fd=20))\n'
        content += 'LISTEN 0 511 127.0.0.1:4795 0.0.0.0:* users:(("node",pid=102,fd=20))\n'
        validate_listeners(content, {4792: 101, 4795: 102})
        for changed in (content.replace('127.0.0.1:4795', '0.0.0.0:4795'),
                        content.replace('pid=102', 'pid=999'), content + content,
                        content.splitlines()[0], content.replace('127.0.0.1:4792', '[::]:4792')):
            with self.subTest(changed=changed), self.assertRaises(Refused):
                validate_listeners(changed, {4792: 101, 4795: 102})


if __name__ == '__main__':
    unittest.main()
