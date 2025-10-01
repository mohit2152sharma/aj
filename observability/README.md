## FastAPI server with OpenTelemetry Tracing

A fully instrumented FastAPI application with Google Cloud Trace integration.

### Features

- **FastAPI REST API** with automatic OpenAPI documentation
- **OpenTelemetry tracing** with Google Cloud Trace integration  
- **Custom spans and attributes** for detailed observability
- **Kubernetes deployment** with proper service account configuration
- **CI/CD pipeline** with GitHub Actions

### Run locally

```bash
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Endpoints

- POST `/greet` body: `{ "username": "alice" }` → `{ "message": "hello alice" }`
- GET `/greet/{username}` → `{ "message": "hello username" }`
- GET `/greet/health` → `{ "status": "healthy", "service": "observability" }`

### Docker

```bash
docker build -t observability:local .
docker run -p 8000:8000 observability:local
```

### Health check

```bash
curl -s localhost:8000/greet/world | jq .
# { "message": "hello world" }

curl -s localhost:8000/greet/health | jq .
# { "status": "healthy", "service": "observability" }
```

## Tracing

All HTTP requests are automatically traced with OpenTelemetry. Custom business logic includes:

- User identification in spans
- Request type classification  
- Processing milestones as span events
- Performance metrics and attributes

To enable tracing, set the `GOOGLE_CLOUD_PROJECT` environment variable.

For detailed tracing setup, see [TRACING.md](TRACING.md).

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for complete deployment instructions including:

- Google Cloud setup
- Kubernetes manifests
- CI/CD pipeline configuration
- Service account and IAM setup

