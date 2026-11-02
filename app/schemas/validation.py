import re

USERNAME = re.compile(r'^[A-Za-z0-9_]{3,32}$')
EMAIL = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')

def valid_username(value: str) -> bool:
    return bool(USERNAME.fullmatch(value))

def valid_email(value: str) -> bool:
    return len(value) <= 254 and bool(EMAIL.fullmatch(value))

def valid_password(value: str) -> bool:
    return 10 <= len(value) <= 1024
