from typing import Literal, cast

from fastapi import APIRouter

from ..models.info import Status

router = APIRouter(prefix="/info", tags=["info"])


@router.get("/status")
async def get_status():
    return Status(status=cast(Literal["success"], "success"), status_code=200)
