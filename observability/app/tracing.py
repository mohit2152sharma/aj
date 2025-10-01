"""OpenTelemetry tracing and metrics configuration for Google Cloud Trace and Monitoring."""

import os
from typing import Optional

from opentelemetry import metrics, trace
from opentelemetry.exporter.cloud_monitoring import CloudMonitoringMetricsExporter
from opentelemetry.exporter.cloud_trace import CloudTraceSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.propagate import set_global_textmap
from opentelemetry.propagators.cloud_trace_propagator import CloudTraceFormatPropagator
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from app import PROJECT_ID


def setup_tracing(app_name: str = "observability") -> Optional[trace.Tracer]:
    """
    Set up OpenTelemetry tracing with Google Cloud Trace.

    Args:
        app_name: Name of the application for tracing

    Returns:
        Tracer instance if tracing is enabled, None otherwise
    """
    # Check if tracing is enabled
    project_id = PROJECT_ID
    if not project_id:
        print("Warning: PROJECT_ID not set, tracing disabled")
        return None

    print(f"Setting up tracing for project: {project_id}")

    # Create resource with service information
    resource = Resource.create(
        {
            "service.name": app_name,
            "service.version": os.getenv("SERVICE_VERSION", "1.0.0"),
            "service.instance.id": os.getenv("HOSTNAME", "unknown"),
        }
    )

    # Set up tracer provider
    tracer_provider = TracerProvider(resource=resource)
    trace.set_tracer_provider(tracer_provider)

    # Create Cloud Trace exporter
    cloud_trace_exporter = CloudTraceSpanExporter(project_id=project_id)

    # Add batch span processor
    span_processor = BatchSpanProcessor(cloud_trace_exporter)
    tracer_provider.add_span_processor(span_processor)

    # Set up Cloud Trace propagator for distributed tracing
    set_global_textmap(CloudTraceFormatPropagator())

    # Get tracer
    tracer = trace.get_tracer(__name__)

    print("OpenTelemetry tracing configured successfully")
    return tracer


def setup_metrics(app_name: str = "observability") -> Optional[metrics.Meter]:
    """
    Set up OpenTelemetry metrics with Google Cloud Monitoring.

    Args:
        app_name: Name of the application for metrics

    Returns:
        Meter instance if metrics are enabled, None otherwise
    """
    project_id = PROJECT_ID
    if not project_id:
        print("Warning: PROJECT_ID not set, metrics disabled")
        return None

    print(f"Setting up metrics for project: {project_id}")

    resource = Resource.create(
        {
            "service.name": app_name,
            "service.version": os.getenv("SERVICE_VERSION", "1.0.0"),
            "service.instance.id": os.getenv("HOSTNAME", "unknown"),
        }
    )

    exporter = CloudMonitoringMetricsExporter(project_id=project_id)
    # Export every 30s by default
    reader = PeriodicExportingMetricReader(exporter)
    provider = MeterProvider(resource=resource, metric_readers=[reader])
    metrics.set_meter_provider(provider)

    meter = metrics.get_meter(__name__)

    print("OpenTelemetry metrics configured successfully")
    return meter


# ----- Custom application metrics -----
_meter = None
_greet_requests_counter = None
_greet_latency_histogram = None
_inflight_requests_updown = None
_http_duration_histogram = None


def init_custom_metrics() -> None:
    """Create custom metric instruments used by the application."""
    global _meter, _greet_requests_counter, _greet_latency_histogram, _inflight_requests_updown, _http_duration_histogram

    if _meter is None:
        _meter = metrics.get_meter("observability.metrics")

    if _greet_requests_counter is None:
        _greet_requests_counter = _meter.create_counter(
            name="workload.googleapis.com/greet_requests_total",
            description="Total number of greet requests",
            unit="1",
        )

    if _greet_latency_histogram is None:
        _greet_latency_histogram = _meter.create_histogram(
            name="workload.googleapis.com/greet_latency_ms",
            description="Latency of greet endpoint in milliseconds",
            unit="ms",
        )

    if _inflight_requests_updown is None:
        _inflight_requests_updown = _meter.create_up_down_counter(
            name="workload.googleapis.com/http_inflight_requests",
            description="In-flight HTTP requests",
            unit="1",
        )

    if _http_duration_histogram is None:
        _http_duration_histogram = _meter.create_histogram(
            name="workload.googleapis.com/http_request_duration_ms",
            description="HTTP request duration in milliseconds",
            unit="ms",
        )


def record_greet_request(username: str, method: str, status_code: int) -> None:
    """Record greet request count with attributes."""
    if _greet_requests_counter is None:
        return
    attributes = {
        "http.method": method,
        "http.route": "/greet",
        "user.name": username,
        "http.status_code": str(status_code),
    }
    _greet_requests_counter.add(1, attributes)


def record_greet_latency_ms(duration_ms: float, method: str, status_code: int) -> None:
    """Record greet request latency in ms."""
    if _greet_latency_histogram is None:
        return
    attributes = {
        "http.method": method,
        "http.route": "/greet",
        "http.status_code": str(status_code),
    }
    _greet_latency_histogram.record(float(duration_ms), attributes)


def inflight_requests_change(delta: int, route: str) -> None:
    """Increment/decrement in-flight requests gauge."""
    if _inflight_requests_updown is None:
        return
    _inflight_requests_updown.add(delta, {"http.route": route})


def record_http_request_duration_ms(
    duration_ms: float, method: str, route: str, status_code: int
) -> None:
    """Record generic HTTP request duration."""
    if _http_duration_histogram is None:
        return
    attributes = {
        "http.method": method,
        "http.route": route,
        "http.status_code": str(status_code),
    }
    _http_duration_histogram.record(float(duration_ms), attributes)


def instrument_fastapi(app) -> None:
    """
    Instrument FastAPI application with OpenTelemetry.

    Args:
        app: FastAPI application instance
    """
    # Instrument FastAPI
    FastAPIInstrumentor.instrument_app(
        app,
        tracer_provider=trace.get_tracer_provider(),
        excluded_urls="health,metrics",  # Exclude health check from tracing
    )

    # Instrument outgoing HTTP requests for distributed tracing
    RequestsInstrumentor().instrument()

    print("FastAPI instrumentation completed")


def get_current_span():
    """Get the current active span."""
    return trace.get_current_span()


def add_span_attribute(key: str, value: str) -> None:
    """Add attribute to current span."""
    span = get_current_span()
    if span:
        span.set_attribute(key, value)


def add_span_event(name: str, attributes: dict = None) -> None:
    """Add event to current span."""
    span = get_current_span()
    if span:
        span.add_event(name, attributes or {})
