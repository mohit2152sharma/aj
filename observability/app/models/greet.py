from pydantic import BaseModel


class GreetRequest(BaseModel):
    username: str


class GreetResponse(BaseModel):
    message: str

