# WebRTC Server Deployment with STUNner

This directory contains Kubernetes manifest files for deploying a WebRTC server with STUNner for STUN/TURN services.

## Prerequisites

1. Kubernetes cluster (1.23+)
2. STUNner installed via Helm charts
3. Docker registry access for pushing the WebRTC server image
4. kubectl configured to access your cluster

## File Structure

- `Dockerfile` - Docker image for the WebRTC server
- `aj-webrtc-server.yaml` - Kubernetes manifests for the WebRTC server deployment
- `aj-webrtc-stunner.yaml` - STUNner configuration for STUN/TURN services
- `docker-compose.yaml` - Local testing configuration

## Building and Pushing the Docker Image

1. Build the Docker image:
```bash
docker build -t aj-webrtc-server:latest .
```

2. Tag and push to your registry:
```bash
docker tag aj-webrtc-server:latest your-registry/aj-webrtc-server:latest
docker push your-registry/aj-webrtc-server:latest
```

3. Update the image reference in `aj-webrtc-server.yaml`:
```yaml
image: your-registry/aj-webrtc-server:latest
```

## Deployment Steps

### 1. Install STUNner (if not already installed)

```bash
helm repo add stunner https://l7mp.io/stunner
helm repo update
helm install stunner-gateway-operator stunner/stunner-gateway-operator \
  --create-namespace --namespace=stunner-system
```

### 2. Configure Secrets

Before deploying, update the OpenAI API key in the secret:

```bash
kubectl create secret generic aj-webrtc-secret \
  --from-literal=OPENAI_API_KEY=your-actual-api-key \
  --namespace=default
```

Or edit the secret in `aj-webrtc-server.yaml` before applying.

### 3. Deploy the WebRTC Server

```bash
kubectl apply -f aj-webrtc-server.yaml
```

### 4. Deploy STUNner Configuration

```bash
kubectl apply -f aj-webrtc-stunner.yaml
```

### 5. Verify Deployment

Check if all pods are running:
```bash
kubectl get pods -l app=aj-webrtc
kubectl get gateway aj-webrtc-gateway
kubectl get gatewayconfig aj-webrtc-gatewayconfig -n stunner-system
```

Check the STUNner gateway status:
```bash
kubectl describe gateway aj-webrtc-gateway
```

## Configuration

### Environment Variables

The following environment variables can be configured via the ConfigMap `aj-webrtc-config`:

- `WS_PORT`: WebSocket server port (default: 8080)
- `STUN_SERVER_URL`: STUN server URL
- `TURN_SERVER_URL`: TURN server URL
- `TURN_USERNAME`: TURN authentication username
- `TURN_PASSWORD`: TURN authentication password
- `ENABLE_AUDIO`: Enable audio streaming (true/false)
- `ENABLE_VIDEO`: Enable video streaming (true/false)

### STUNner Configuration

The STUNner gateway is configured with:
- UDP listener on port 3478 for WebRTC media
- TCP listener on port 3478 as fallback
- Plain text authentication (username: "user", password: "pass")

**Important**: For production, change the authentication credentials in both:
- `aj-webrtc-stunner.yaml` (GatewayConfig)
- `aj-webrtc-server.yaml` (ConfigMap)

## Accessing the Service

### Internal Access (within cluster)

- WebSocket: `ws://aj-webrtc-service:8080`
- STUN/TURN: `stun:aj-webrtc-gateway:3478` / `turn:aj-webrtc-gateway:3478`

### External Access

1. Configure the Ingress host in `aj-webrtc-server.yaml`:
```yaml
spec:
  rules:
  - host: your-domain.com
```

2. For STUNner external access, create a LoadBalancer service:
```bash
kubectl expose gateway aj-webrtc-gateway \
  --name=aj-webrtc-gateway-lb \
  --type=LoadBalancer \
  --port=3478 \
  --target-port=3478
```

## Monitoring and Logs

View server logs:
```bash
kubectl logs -l app=aj-webrtc -f
```

View STUNner logs:
```bash
kubectl logs -n stunner-system -l app.kubernetes.io/name=stunner-gateway-operator -f
```

## Troubleshooting

1. **WebSocket Connection Issues**
   - Check if the pod is running: `kubectl get pods -l app=aj-webrtc`
   - Check service endpoints: `kubectl get endpoints aj-webrtc-service`
   - Review logs: `kubectl logs -l app=aj-webrtc`

2. **STUN/TURN Connection Issues**
   - Verify gateway status: `kubectl get gateway aj-webrtc-gateway`
   - Check STUNner dataplane: `kubectl get pods -n stunner-system`
   - Test STUN connectivity: Use a STUN test tool or WebRTC diagnostics

3. **Media Stream Issues**
   - Ensure both audio and video are enabled in ConfigMap
   - Check network policies if enabled
   - Verify UDP/TCP ports are accessible

## Scaling

To scale the WebRTC server:
```bash
kubectl scale deployment aj-webrtc-server --replicas=3
```

Note: WebRTC signaling servers typically require sticky sessions or state sharing for proper scaling.

## Cleanup

To remove all resources:
```bash
kubectl delete -f aj-webrtc-stunner.yaml
kubectl delete -f aj-webrtc-server.yaml
```

## Security Considerations

1. **Change default credentials** in production
2. **Use TLS/SSL** for WebSocket connections
3. **Implement proper authentication** for WebRTC clients
4. **Configure network policies** to restrict traffic
5. **Use secrets management** solutions for API keys
6. **Enable TURN authentication** with secure credentials

## Support for Audio and Video

This deployment is configured to handle both audio and video streams:
- Audio codec support via WebRTC
- Video codec support via WebRTC
- Configurable via environment variables
- STUNner handles NAT traversal for both media types