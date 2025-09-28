from app.models.greet import GreetRequest, GreetResponse
from fastapi import APIRouter

router = APIRouter(prefix="/greet", tags=["greet"])


@router.post("", response_model=GreetResponse)
def greet(request: GreetRequest) -> GreetResponse:
    return GreetResponse(message=f"hello {request.username}")


@router.get("/{username}", response_model=GreetResponse)
def greet_get(username: str) -> GreetResponse:
    return GreetResponse(message=f"hello {username}")


@router.get("/health")
def health_check():
    return {"status": "healthy"}
