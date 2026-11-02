import unittest
from app.schemas.validation import valid_username, valid_email, valid_password

class ValidationTests(unittest.TestCase):
    def test_username(self):
        self.assertTrue(valid_username('movie_fan42'))
        for name in ('ab', 'a@b.com', 'hello world', '<script>'):
            self.assertFalse(valid_username(name))
    def test_email(self):
        self.assertTrue(valid_email('a@example.com'))
        for email in ('foo', 'a@b', 'a @example.com'):
            self.assertFalse(valid_email(email))
    def test_password(self):
        self.assertFalse(valid_password('123456789'))
        self.assertTrue(valid_password('1234567890'))
        self.assertFalse(valid_password('x' * 1025))

if __name__ == '__main__': unittest.main()
