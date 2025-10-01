# Kubernetes Manifests

This directory contains Kubernetes manifests for deploying the observability service to GKE.

## Files

- **`namespace.yaml`**: Creates the `observability` namespace
- **`deployment.yaml`**: Defines the main application deployment with 3 replicas
- **`service.yaml`**: Exposes the application internally on port 80  
- **`ingress.yaml`**: Configures external access with SSL (requires domain setup)
- **`service-account.yaml`**: Service account with Cloud Trace permissions

## Features

- **Health Checks**: Liveness and readiness probes on `/greet/health`
- **Resource Limits**: Memory (256Mi) and CPU (200m) limits set
- **Auto-scaling**: Deployment supports 3 replicas by default
- **SSL/TLS**: Managed certificates through Google Cloud (requires domain)
- **OpenTelemetry Tracing**: Automatic tracing with Google Cloud Trace integration
- **Service Account**: Proper IAM configuration for cloud services access

## Quick Deploy

```bash
kubectl apply -f .
```

## Check Status

```bash
kubectl get all -n observability
kubectl logs deployment/observability -n observability
```

## Notes

- The `PROJECT_ID` placeholder in `deployment.yaml` gets replaced during CI/CD
- Images are pushed to the `dev-opentelemetry` registry in Artifact Registry
- Modify `ingress.yaml` to use your actual domain name
- Health endpoint added to `/greet/health` in the FastAPI app
