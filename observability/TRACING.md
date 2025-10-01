# OpenTelemetry Tracing Setup

This application is instrumented with OpenTelemetry to send traces to Google Cloud Trace.

## Features

- **Automatic FastAPI instrumentation**: All HTTP requests are automatically traced
- **Custom spans and attributes**: Business logic includes custom tracing data
- **Google Cloud Trace integration**: Traces are sent directly to Google Cloud
- **Distributed tracing**: Support for trace propagation across services

## Configuration

### Environment Variables

The following environment variables configure tracing:

- `GOOGLE_CLOUD_PROJECT`: Your Google Cloud project ID (required)
- `OTEL_SERVICE_NAME`: Service name for traces (default: "observability")
- `SERVICE_VERSION`: Version of the service (default: "1.0.0")
- `OTEL_RESOURCE_ATTRIBUTES`: Additional resource attributes

### Automatic Configuration

The application automatically:
1. Detects Google Cloud environment
2. Sets up Cloud Trace exporter
3. Configures trace propagation
4. Instruments FastAPI endpoints

## Custom Tracing Examples

### Adding Custom Attributes

```python
from app.tracing import add_span_attribute

def my_function(user_id: str):
    add_span_attribute("user.id", user_id)
    add_span_attribute("operation.type", "user_lookup")
    # Your business logic here
```

### Adding Events

```python
from app.tracing import add_span_event

def process_data(data):
    add_span_event("processing_started", {"data_size": len(data)})
    # Process data
    add_span_event("processing_completed", {"processed_items": 10})
```

### Manual Span Creation

```python
from opentelemetry import trace

def complex_operation():
    tracer = trace.get_tracer(__name__)
    with tracer.start_as_current_span("complex_operation") as span:
        span.set_attribute("operation.complexity", "high")
        # Your complex logic here
        span.add_event("operation_milestone_reached")
```

## Viewing Traces

1. Go to Google Cloud Console
2. Navigate to "Trace" service
3. Select your project
4. View traces and analyze performance

### Trace Structure

Each HTTP request creates a trace with:
- **Root span**: HTTP request details
- **Custom spans**: Business logic operations
- **Attributes**: Request metadata, user info, etc.
- **Events**: Important milestones in processing

## Performance Considerations

- Traces are sent asynchronously to minimize latency
- Health check endpoints are excluded from tracing
- Batch span processor reduces network overhead
- Resource attributes are set once at startup

## Troubleshooting

### No traces appearing in Google Cloud

1. Check `GOOGLE_CLOUD_PROJECT` is set correctly
2. Verify service account has `cloudtrace.agent` role
3. Check application logs for tracing errors
4. Ensure Google Cloud Trace API is enabled

### High trace volume

1. Adjust sampling rate if needed
2. Consider excluding more endpoints
3. Use trace filtering in Google Cloud Console

### Local Development

For local development without Google Cloud:

```python
# Disable tracing by not setting GOOGLE_CLOUD_PROJECT
# Or set to empty string to disable
export GOOGLE_CLOUD_PROJECT=""
```

## Integration with Other Services

The tracing setup supports:
- **HTTP propagation**: Traces continue across HTTP calls
- **gRPC propagation**: Works with gRPC services
- **Database instrumentation**: Can be extended for DB calls
- **Message queue tracing**: Compatible with pub/sub systems

