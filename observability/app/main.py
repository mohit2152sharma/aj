import time

from fastapi import FastAPI
from starlette.requests import Request
from starlette.responses import Response

from app.api.routers.greet import router as greet_router
from app.settings import SERVICE_NAME as SETTINGS_SERVICE_NAME
from app.tracing import (
    inflight_requests_change,
    init_custom_metrics,
    instrument_fastapi,
    record_http_request_duration_ms,
    setup_metrics,
    setup_tracing,
)

# Determine service name from centralized settings
SERVICE_NAME = SETTINGS_SERVICE_NAME

# Set up tracing and metrics before creating the app
print(f"[Startup] Initializing observability for service: {SERVICE_NAME}")
tracer = setup_tracing(SERVICE_NAME)
print(f"[Startup] Tracing ready: {bool(tracer)}")
meter = setup_metrics(SERVICE_NAME)
print(f"[Startup] Metrics ready: {bool(meter)}")
init_custom_metrics()
print("[Startup] Custom metrics initialized")

app = FastAPI(title=SERVICE_NAME)

# Instrument the FastAPI app with OpenTelemetry
print("[Startup] Instrumenting FastAPI app...")
instrument_fastapi(app)
print("[Startup] FastAPI instrumentation done")


@app.middleware("http")
async def metrics_http_middleware(request: Request, call_next):
    route = request.url.path
    method = request.method
    start = time.perf_counter()
    inflight_requests_change(1, route)
    response: Response | None = None
    try:
        response: Response = await call_next(request)
        return response
    finally:
        duration_ms = (time.perf_counter() - start) * 1000.0
        status_code = getattr(response, "status_code", 500)
        record_http_request_duration_ms(duration_ms, method, route, int(status_code))
        inflight_requests_change(-1, route)


app.include_router(greet_router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
