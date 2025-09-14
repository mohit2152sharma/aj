# Use the custom base image
FROM pb

# Set work directory
WORKDIR /app

# Copy project files
COPY . /app/

# Install dependencies using uv
RUN uv sync
RUN uv run opentelemetry-bootstrap -a requirements | uv pip install --requirement -

# OpenTelemetry environment variables
ENV OTEL_SERVICE_NAME="alphine-uv-test"
ENV OTEL_SERVICE_VERSION="0.1.0"
ENV OTEL_RESOURCE_ATTRIBUTES="service.name=alphine-uv-test,service.version=0.1.0"
ENV OTEL_TRACES_EXPORTER="otlp"
ENV OTEL_METRICS_EXPORTER="otlp"
ENV OTEL_LOGS_EXPORTER="otlp"
ENV OTEL_EXPORTER_OTLP_PROTOCOL="grpc"
ENV OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4317"

# Expose port
EXPOSE 8000

# Start FastAPI server
CMD [".venv/bin/opentelemetry-instrument", ".venv/bin/uvicorn", "hello:app", "--host", "0.0.0.0", "--port", "8000"]
