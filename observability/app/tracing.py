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
from opentelemetry.resourcedetector.gcp_resource_detector import (
    GoogleCloudResourceDetector,
)
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource, get_aggregated_resources
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

    print(f"[Tracing] Starting setup for project: {project_id}")
    try:
        # Detect GCP/GKE resources and merge with explicit service attributes
        print("[Tracing] Detecting GCP resources...")
        detected_resource = get_aggregated_resources(
            [GoogleCloudResourceDetector(raise_on_error=True)]
        )
        service_version = os.getenv("SERVICE_VERSION", "1.0.0")
        service_instance = os.getenv("HOSTNAME", "unknown")
        print(
            f"[Tracing] Using service attrs name={app_name}, version={service_version}, instance={service_instance}"
        )
        resource = detected_resource.merge(
            Resource.create(
                {
                    "service.name": app_name,
                    "service.version": service_version,
                    "service.instance.id": service_instance,
                }
            )
        )

        # Set up tracer provider
        print("[Tracing] Creating TracerProvider...")
        tracer_provider = TracerProvider(resource=resource)
        trace.set_tracer_provider(tracer_provider)
        print(
            f"[Tracing] TracerProvider set: {type(trace.get_tracer_provider()).__name__}"
        )

        # Create Cloud Trace exporter and include all resource attributes on spans
        print("[Tracing] Initializing CloudTraceSpanExporter...")
        cloud_trace_exporter = CloudTraceSpanExporter(
            project_id=project_id,
            resource_regex=r".*",
        )
        print("[Tracing] CloudTraceSpanExporter initialized")

        # Add batch span processor
        print("[Tracing] Adding BatchSpanProcessor...")
        span_processor = BatchSpanProcessor(cloud_trace_exporter)
        tracer_provider.add_span_processor(span_processor)
        print("[Tracing] BatchSpanProcessor added")

        # Set up Cloud Trace propagator for distributed tracing
        print("[Tracing] Setting CloudTraceFormatPropagator...")
        set_global_textmap(CloudTraceFormatPropagator())
        print("[Tracing] Propagator set")

        # Get tracer
        tracer = trace.get_tracer(__name__)
        print(f"[Tracing] Tracer acquired: {tracer}")

        print("[Tracing] OpenTelemetry tracing configured successfully")
        return tracer
    except Exception as exc:
        print(f"[Tracing][ERROR] Failed to configure tracing: {exc}")
        return None


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

    print(f"[Metrics] Starting setup for project: {project_id}")
    try:
        print("[Metrics] Detecting GCP resources...")
        detected_resource = get_aggregated_resources(
            [GoogleCloudResourceDetector(raise_on_error=True)]
        )
        service_version = os.getenv("SERVICE_VERSION", "1.0.0")
        service_instance = os.getenv("HOSTNAME", "unknown")
        print(
            f"[Metrics] Using service attrs name={app_name}, version={service_version}, instance={service_instance}"
        )
        resource = detected_resource.merge(
            Resource.create(
                {
                    "service.name": app_name,
                    "service.version": service_version,
                    "service.instance.id": service_instance,
                }
            )
        )

        print("[Metrics] Initializing CloudMonitoringMetricsExporter...")
        exporter = CloudMonitoringMetricsExporter(project_id=project_id)
        print("[Metrics] Exporter initialized")
        # Export every 30s by default
        print("[Metrics] Creating PeriodicExportingMetricReader...")
        reader = PeriodicExportingMetricReader(exporter)
        print("[Metrics] Reader created")
        print("[Metrics] Creating MeterProvider...")
        provider = MeterProvider(resource=resource, metric_readers=[reader])
        metrics.set_meter_provider(provider)
        print("[Metrics] MeterProvider set")

        meter = metrics.get_meter(__name__)
        print(f"[Metrics] Meter acquired: {meter}")

        print("[Metrics] OpenTelemetry metrics configured successfully")
        return meter
    except Exception as exc:
        print(f"[Metrics][ERROR] Failed to configure metrics: {exc}")
        return None


# ----- Custom application metrics -----
_meter = None
_greet_requests_counter = None
_greet_latency_histogram = None
_inflight_requests_updown = None
_http_duration_histogram = None


def init_custom_metrics() -> None:
    """Create custom metric instruments used by the application."""
    global _meter, _greet_requests_counter, _greet_latency_histogram, _inflight_requests_updown, _http_duration_histogram

    print("[Metrics] Initializing custom metric instruments...")
    if _meter is None:
        _meter = metrics.get_meter("observability.metrics")
        print("[Metrics] Custom meter created: observability.metrics")

    if _greet_requests_counter is None:
        _greet_requests_counter = _meter.create_counter(
            name="workload.googleapis.com/greet_requests_total",
            description="Total number of greet requests",
            unit="1",
        )
        print("[Metrics] Counter created: greet_requests_total")

    if _greet_latency_histogram is None:
        _greet_latency_histogram = _meter.create_histogram(
            name="workload.googleapis.com/greet_latency_ms",
            description="Latency of greet endpoint in milliseconds",
            unit="ms",
        )
        print("[Metrics] Histogram created: greet_latency_ms")

    if _inflight_requests_updown is None:
        _inflight_requests_updown = _meter.create_up_down_counter(
            name="workload.googleapis.com/http_inflight_requests",
            description="In-flight HTTP requests",
            unit="1",
        )
        print("[Metrics] UpDownCounter created: http_inflight_requests")

    if _http_duration_histogram is None:
        _http_duration_histogram = _meter.create_histogram(
            name="workload.googleapis.com/http_request_duration_ms",
            description="HTTP request duration in milliseconds",
            unit="ms",
        )
        print("[Metrics] Histogram created: http_request_duration_ms")
    print("[Metrics] Custom metric instruments initialized")


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
    print("[Tracing] Instrumenting FastAPI application...")
    try:
        current_provider = trace.get_tracer_provider()
        print(f"[Tracing] Current TracerProvider: {type(current_provider).__name__}")

        # Instrument FastAPI
        FastAPIInstrumentor.instrument_app(
            app,
            tracer_provider=current_provider,
            excluded_urls="health,metrics",  # Exclude health check from tracing
        )
        print("[Tracing] FastAPI application instrumented")

        # Instrument outgoing HTTP requests for distributed tracing
        RequestsInstrumentor().instrument()
        print("[Tracing] Requests instrumentation enabled")

        print("[Tracing] FastAPI instrumentation completed")
    except Exception as exc:
        print(f"[Tracing][ERROR] FastAPI instrumentation failed: {exc}")


def get_current_span():
    """Get the current active span."""
    return trace.get_current_span()


def add_span_attribute(key: str, value: str) -> None:
    """Add attribute to current span."""
    span = get_current_span()
    if span:
        span.set_attribute(key, value)


def add_span_event(name: str, attributes: dict | None = None) -> None:
    """Add event to current span."""
    span = get_current_span()
    if span:
        span.add_event(name, attributes or {})
