import os
import time

import requests
from fastapi import APIRouter, HTTPException

from app.models.greet import GreetRequest, GreetResponse
from app.settings import SERVICE_NAME
from app.tracing import (
    add_span_attribute,
    add_span_event,
    get_current_span,
    record_greet_latency_ms,
    record_greet_request,
)

router = APIRouter(prefix="/greet", tags=["greet"])


@router.post("", response_model=GreetResponse)
def greet(request: GreetRequest) -> GreetResponse:
    # Add custom tracing attributes and events
    start = time.perf_counter()
    add_span_attribute("user.name", request.username)
    add_span_attribute("greeting.type", "post")
    add_span_event("greeting_started", {"username": request.username})

    message = f"hello {request.username}"

    add_span_event("greeting_completed", {"message": message})
    status_code = 200
    record_greet_request(request.username, "POST", status_code)
    record_greet_latency_ms((time.perf_counter() - start) * 1000.0, "POST", status_code)
    return GreetResponse(message=message)


@router.get("/{username}", response_model=GreetResponse)
def greet_get(username: str) -> GreetResponse:
    # Add custom tracing attributes and events
    start = time.perf_counter()
    add_span_attribute("user.name", username)
    add_span_attribute("greeting.type", "get")
    add_span_event("greeting_started", {"username": username})

    message = f"hello {username}"

    add_span_event("greeting_completed", {"message": message})
    status_code = 200
    record_greet_request(username, "GET", status_code)
    record_greet_latency_ms((time.perf_counter() - start) * 1000.0, "GET", status_code)
    return GreetResponse(message=message)


@router.get("/health")
def health_check():
    # Health check endpoint - minimal tracing
    span = get_current_span()
    if span:
        span.set_attribute("health.status", "healthy")
    return {"status": "healthy", "service": SERVICE_NAME}


@router.get("/peer/{username}", response_model=GreetResponse)
def greet_peer(username: str) -> GreetResponse:
    """Call the peer service's greet endpoint and return its response."""
    start = time.perf_counter()
    add_span_attribute("greeting.type", "peer-get")
    add_span_event("peer_greeting_started", {"username": username})

    base_url = os.getenv("PEER_SERVICE_BASE_URL") or ""
    base_url = base_url.rstrip("/")
    if not base_url:
        add_span_event("peer_greeting_missing_base_url")
        raise HTTPException(status_code=500, detail="PEER_SERVICE_BASE_URL not set")

    url = f"{base_url}/greet/{username}"
    try:
        resp = requests.get(url, timeout=5)
        resp.raise_for_status()
        data = resp.json()
        message = data.get("message", f"hello {username}")
        status_code = 200
        add_span_event("peer_greeting_completed", {"message": message})
        record_greet_request(username, "GET", status_code)
        record_greet_latency_ms(
            (time.perf_counter() - start) * 1000.0, "GET", status_code
        )
        return GreetResponse(message=message)
    except requests.RequestException as exc:
        add_span_event("peer_greeting_error", {"error": str(exc)})
        status_code = 502
        record_greet_request(username, "GET", status_code)
        record_greet_latency_ms(
            (time.perf_counter() - start) * 1000.0, "GET", status_code
        )
        raise HTTPException(
            status_code=status_code, detail=f"Peer request failed: {exc}"
        )
