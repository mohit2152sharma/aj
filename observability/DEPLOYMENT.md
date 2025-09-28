# Deployment Guide

## CI/CD Pipeline Setup

This project uses GitHub Actions to automatically build and deploy to Google Kubernetes Engine (GKE).

### Required GitHub Secrets

Set these secrets in your GitHub repository settings:

1. **GCP_PROJECT_ID**: Your Google Cloud project ID
2. **GCP_SA_KEY**: Service account key JSON (see setup below)
3. **GKE_CLUSTER_NAME**: Your GKE cluster name
4. **GKE_ZONE**: Your GKE cluster zone (e.g., us-central1-a)

### Google Cloud Setup

#### 1. Create a Service Account

```bash
# Set your project ID
export PROJECT_ID="your-project-id"

# Create service account
gcloud iam service-accounts create github-actions \
    --description="Service account for GitHub Actions" \
    --display-name="GitHub Actions"

# Grant necessary roles
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:github-actions@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:github-actions@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/container.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:github-actions@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/iam.serviceAccountUser"

# Create and download key
gcloud iam service-accounts keys create github-actions-key.json \
    --iam-account=github-actions@$PROJECT_ID.iam.gserviceaccount.com
```

#### 2. Create Artifact Registry Repository

```bash
# Create repository for Docker images
gcloud artifacts repositories create observability \
    --repository-format=docker \
    --location=us-central1 \
    --description="Docker repository for observability service"
```

#### 3. Create GKE Cluster

```bash
# Create GKE cluster (if you don't have one)
gcloud container clusters create observability-cluster \
    --zone=us-central1-a \
    --num-nodes=3 \
    --enable-autoscaling \
    --min-nodes=1 \
    --max-nodes=5 \
    --machine-type=e2-medium \
    --disk-size=20GB
```

#### 4. Enable Required APIs

```bash
gcloud services enable artifactregistry.googleapis.com
gcloud services enable container.googleapis.com
gcloud services enable cloudbuild.googleapis.com
```

### GitHub Secrets Setup

1. Go to your GitHub repository → Settings → Secrets and variables → Actions
2. Add the following secrets:
   - `GCP_PROJECT_ID`: Your Google Cloud project ID
   - `GCP_SA_KEY`: Contents of the `github-actions-key.json` file
   - `GKE_CLUSTER_NAME`: Your GKE cluster name (e.g., `observability-cluster`)
   - `GKE_ZONE`: Your GKE cluster zone (e.g., `us-central1-a`)

### Manual Build and Push

If you need to build and push manually:

```bash
# Configure Docker for Artifact Registry
gcloud auth configure-docker us-central1-docker.pkg.dev

# Build and tag
docker build -t us-central1-docker.pkg.dev/$PROJECT_ID/observability/observability:latest ./observability/

# Push
docker push us-central1-docker.pkg.dev/$PROJECT_ID/observability/observability:latest
```

### Deployment Triggers

The pipeline triggers on:
- Push to `main` or `develop` branches (with changes in `observability/` folder)
- Pull requests to `main` branch (with changes in `observability/` folder)

### Manual Kubectl Deployment

If you need to deploy manually using kubectl:

```bash
# Get cluster credentials
gcloud container clusters get-credentials observability-cluster --zone=us-central1-a

# Apply manifests
kubectl apply -f observability/k8s/

# Check deployment status
kubectl rollout status deployment/observability -n observability

# Get service info
kubectl get services -n observability
kubectl get ingress -n observability
```

### Customization

You can modify the following:

**In `.github/workflows/observability-deploy.yml`:**
- `GAR_LOCATION`: Change the Artifact Registry location
- `GKE_CLUSTER` and `GKE_ZONE`: Change your cluster details
- Add environment variables or secrets for your app

**In `observability/k8s/` manifests:**
- `deployment.yaml`: Adjust replicas, resources, environment variables
- `ingress.yaml`: Configure your domain and SSL certificates
- Add ConfigMaps, Secrets, or other Kubernetes resources as needed
