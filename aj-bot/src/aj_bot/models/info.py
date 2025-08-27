from typing import Literal

from pydantic import BaseModel


class Status(BaseModel):
    status: Literal["success", "fail"]
    status_code: Literal[200, 500]
