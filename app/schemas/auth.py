from pydantic import BaseModel, Field

class Register(BaseModel):
    username: str = Field(max_length=32)
    email: str = Field(max_length=254)
    password: str = Field(max_length=1024)
    terms: bool
class Login(BaseModel):
    identifier: str = Field(max_length=254)
    password: str = Field(max_length=1024)
    remember: bool = False
class EmailInput(BaseModel):
    email: str = Field(max_length=254)
class TokenInput(BaseModel):
    token: str = Field(min_length=20, max_length=128)
class Reset(TokenInput):
    password: str = Field(max_length=1024)
class ChangePassword(BaseModel):
    current_password: str = Field(max_length=1024)
    new_password: str = Field(max_length=1024)
class Profile(BaseModel):
    username: str = Field(max_length=32)

