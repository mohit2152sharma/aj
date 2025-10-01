import os

# Centralized service name to avoid circular imports
SERVICE_NAME = os.getenv("OTEL_SERVICE_NAME", "observability")
