#!/bin/bash

# AJ-WebRTC Deployment Script
# This script helps deploy the WebRTC server with STUNner to Kubernetes

set -e

# Configuration
NAMESPACE="default"
IMAGE_TAG="latest"
REGISTRY=""  # Set your registry here, e.g., "docker.io/username"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Functions
print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_info() {
    echo -e "ℹ $1"
}

# Check prerequisites
check_prerequisites() {
    print_info "Checking prerequisites..."
    
    # Check kubectl
    if ! command -v kubectl &> /dev/null; then
        print_error "kubectl is not installed"
        exit 1
    fi
    print_success "kubectl found"
    
    # Check docker
    if ! command -v docker &> /dev/null; then
        print_error "docker is not installed"
        exit 1
    fi
    print_success "docker found"
    
    # Check cluster connection
    if ! kubectl cluster-info &> /dev/null; then
        print_error "Cannot connect to Kubernetes cluster"
        exit 1
    fi
    print_success "Connected to Kubernetes cluster"
    
    # Check if STUNner is installed
    if ! kubectl get crd gateways.gateway.networking.k8s.io &> /dev/null; then
        print_warning "Gateway CRD not found. Please ensure STUNner is installed."
        echo "Install STUNner with:"
        echo "  helm repo add stunner https://l7mp.io/stunner"
        echo "  helm repo update"
        echo "  helm install stunner-gateway-operator stunner/stunner-gateway-operator --create-namespace --namespace=stunner-system"
        exit 1
    fi
    print_success "STUNner CRDs found"
}

# Build Docker image
build_image() {
    print_info "Building Docker image..."
    
    if [ -z "$REGISTRY" ]; then
        print_warning "No registry specified. Using local image."
        docker build -t aj-webrtc-server:${IMAGE_TAG} .
    else
        docker build -t ${REGISTRY}/aj-webrtc-server:${IMAGE_TAG} .
        print_success "Docker image built: ${REGISTRY}/aj-webrtc-server:${IMAGE_TAG}"
    fi
}

# Push Docker image
push_image() {
    if [ -z "$REGISTRY" ]; then
        print_warning "No registry specified. Skipping push."
        return
    fi
    
    print_info "Pushing Docker image to registry..."
    docker push ${REGISTRY}/aj-webrtc-server:${IMAGE_TAG}
    print_success "Image pushed to registry"
}

# Update manifest with image
update_manifest() {
    if [ -z "$REGISTRY" ]; then
        print_info "Using local image in manifest"
        sed -i "s|image: aj-webrtc-server:latest|image: aj-webrtc-server:${IMAGE_TAG}|g" aj-webrtc-server.yaml
    else
        print_info "Updating manifest with registry image..."
        sed -i "s|image: aj-webrtc-server:latest|image: ${REGISTRY}/aj-webrtc-server:${IMAGE_TAG}|g" aj-webrtc-server.yaml
        print_success "Manifest updated with image: ${REGISTRY}/aj-webrtc-server:${IMAGE_TAG}"
    fi
}

# Deploy to Kubernetes
deploy() {
    print_info "Deploying to Kubernetes..."
    
    # Create namespace if it doesn't exist
    kubectl create namespace ${NAMESPACE} --dry-run=client -o yaml | kubectl apply -f -
    
    # Apply server manifests
    print_info "Applying server manifests..."
    kubectl apply -f aj-webrtc-server.yaml -n ${NAMESPACE}
    print_success "Server manifests applied"
    
    # Apply STUNner configuration
    print_info "Applying STUNner configuration..."
    kubectl apply -f aj-webrtc-stunner.yaml
    print_success "STUNner configuration applied"
    
    # Wait for deployment to be ready
    print_info "Waiting for deployment to be ready..."
    kubectl wait --for=condition=available --timeout=300s deployment/aj-webrtc-server -n ${NAMESPACE}
    print_success "Deployment is ready"
}

# Check deployment status
check_status() {
    print_info "Checking deployment status..."
    
    echo ""
    echo "Pods:"
    kubectl get pods -l app=aj-webrtc -n ${NAMESPACE}
    
    echo ""
    echo "Services:"
    kubectl get svc -l app=aj-webrtc -n ${NAMESPACE}
    
    echo ""
    echo "Gateway:"
    kubectl get gateway aj-webrtc-gateway -n ${NAMESPACE}
    
    echo ""
    echo "Gateway Config:"
    kubectl get gatewayconfig aj-webrtc-gatewayconfig -n stunner-system
}

# Main menu
show_menu() {
    echo ""
    echo "AJ-WebRTC Deployment Script"
    echo "============================"
    echo "1. Full deployment (build, push, deploy)"
    echo "2. Build image only"
    echo "3. Deploy only (use existing image)"
    echo "4. Check deployment status"
    echo "5. View logs"
    echo "6. Delete deployment"
    echo "7. Exit"
    echo ""
    read -p "Select an option: " choice
}

# View logs
view_logs() {
    print_info "Viewing logs for aj-webrtc-server..."
    kubectl logs -l app=aj-webrtc -n ${NAMESPACE} --tail=50 -f
}

# Delete deployment
delete_deployment() {
    print_warning "This will delete all aj-webrtc resources"
    read -p "Are you sure? (y/N): " confirm
    
    if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
        print_info "Deleting resources..."
        kubectl delete -f aj-webrtc-stunner.yaml --ignore-not-found=true
        kubectl delete -f aj-webrtc-server.yaml -n ${NAMESPACE} --ignore-not-found=true
        print_success "Resources deleted"
    else
        print_info "Deletion cancelled"
    fi
}

# Main script
main() {
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --registry)
                REGISTRY="$2"
                shift 2
                ;;
            --namespace)
                NAMESPACE="$2"
                shift 2
                ;;
            --tag)
                IMAGE_TAG="$2"
                shift 2
                ;;
            --help)
                echo "Usage: $0 [OPTIONS]"
                echo "Options:"
                echo "  --registry <registry>  Docker registry (e.g., docker.io/username)"
                echo "  --namespace <namespace>  Kubernetes namespace (default: default)"
                echo "  --tag <tag>  Image tag (default: latest)"
                echo "  --help  Show this help message"
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                exit 1
                ;;
        esac
    done
    
    # Interactive mode
    while true; do
        show_menu
        
        case $choice in
            1)
                check_prerequisites
                build_image
                push_image
                update_manifest
                deploy
                check_status
                ;;
            2)
                check_prerequisites
                build_image
                ;;
            3)
                check_prerequisites
                update_manifest
                deploy
                check_status
                ;;
            4)
                check_status
                ;;
            5)
                view_logs
                ;;
            6)
                delete_deployment
                ;;
            7)
                print_info "Exiting..."
                exit 0
                ;;
            *)
                print_error "Invalid option"
                ;;
        esac
    done
}

# Run main function
main "$@"