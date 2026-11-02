"""Shapes returned by authentication without exposing database credentials."""
from typing import TypedDict

class PublicUser(TypedDict):
    id: int
    username: str
    email: str
    email_verified: bool
