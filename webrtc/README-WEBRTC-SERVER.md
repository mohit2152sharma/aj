# WebRTC Server Manager

A modular, composable TypeScript implementation for managing WebRTC connections with Kurento Media Server integration and STUNner support.

## 📋 Overview

This WebRTC Server Manager provides a clean, modular architecture for building WebRTC applications with server-side media processing capabilities. It's designed following best practices for TypeScript development with emphasis on:

- **Modularity**: Separate concerns into distinct, reusable components
- **Composability**: Easy to extend and customize for different use cases
- **Type Safety**: Full TypeScript support with comprehensive type definitions
- **Testability**: Well-structured code with dependency injection for easy testing
- **Production Ready**: Error handling, logging, and graceful shutdown support

## 🏗️ Architecture

The system is composed of several key components:

### Core Components

1. **`WebRTCServerManager`**: Main orchestrator class that manages the entire WebRTC server
2. **`IceConfigurationManager`**: Handles ICE/STUN/TURN configuration and STUNner integration
3. **`SessionManager`**: Manages WebRTC sessions and ICE candidates queue
4. **`MediaPipelineManager`**: Interfaces with Kurento Media Server for media pipeline creation
5. **`WebSocketHandler`**: Handles WebSocket connections and message routing

### File Structure

```
webrtc/
├── webrtc-server-manager.ts      # Main implementation file
├── webrtc-server-example.ts      # Example usage and application
├── webrtc-server-manager.test.ts # Comprehensive test suite
└── README-WEBRTC-SERVER.md       # This documentation
```

## 🚀 Quick Start

### Basic Usage

```typescript
import { createWebRTCServer } from './webrtc-server-manager';

const server = createWebRTCServer({
  asUri: 'https://localhost:8443/',
  wsUri: 'ws://localhost:8888/kurento',
  sslKey: 'keys/server.key',
  sslCert: 'keys/server.crt',
});

// Set up middleware
server.setupMiddleware();

// Start the server
await server.start();
```

### With STUNner Integration

```typescript
import { createWebRTCServerWithStunner } from './webrtc-server-manager';

const server = createWebRTCServerWithStunner(
  {
    asUri: 'https://localhost:8443/',
    wsUri: 'ws://localhost:8888/kurento',
    overlayUri: 'http://overlay.local/image.png',
  },
  {
    authAddress: 'stunner-auth.local',
    authPort: '8088',
  }
);

await server.start();
```

## 📦 Installation

### Prerequisites

```bash
npm install express ws kurento-client
npm install --save-dev @types/express @types/ws vitest
```

### Package.json Dependencies

```json
{
  "dependencies": {
    "express": "^4.18.0",
    "express-session": "^1.17.0",
    "cookie-parser": "^1.4.6",
    "ws": "^8.0.0",
    "kurento-client": "^6.18.0",
    "minimist": "^1.2.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/ws": "^8.0.0",
    "@types/node": "^18.0.0",
    "typescript": "^5.0.0",
    "vitest": "^0.34.0"
  }
}
```

## 🔧 Configuration

### Server Configuration

```typescript
interface ServerConfig {
  asUri: string;           // Application server URI
  wsUri: string;           // Kurento WebSocket URI
  overlayUri?: string;     // Optional overlay image URI
  sslKey?: string;         // SSL key file path
  sslCert?: string;        // SSL certificate file path
}
```

### STUNner Configuration

```typescript
interface StunnerConfig {
  authAddress: string;     // STUNner auth service address
  authPort: string;        // STUNner auth service port
  namespace?: string;      // Kubernetes namespace
  gateway?: string;        // STUNner gateway
  listener?: string;       // STUNner listener
}
```

### Environment Variables

The following environment variables can be used to override configuration:

- `STUNNER_AUTH_ADDR`: STUNner authentication service address
- `STUNNER_AUTH_PORT`: STUNner authentication service port
- `STUNNER_NAMESPACE`: Kubernetes namespace for STUNner
- `STUNNER_GATEWAY`: STUNner gateway name
- `STUNNER_LISTENER`: STUNner listener name

## 📡 API Reference

### WebRTCServerManager

#### Methods

- `start()`: Start the server
- `stop()`: Stop the server and clean up resources
- `setupMiddleware(sessionHandler?)`: Set up Express and WebSocket middleware
- `initializeStunner(config)`: Initialize STUNner integration
- `getSessionManager()`: Get the session manager instance
- `getPipelineManager()`: Get the pipeline manager instance
- `getIceManager()`: Get the ICE configuration manager instance
- `getWebSocketHandler()`: Get the WebSocket handler instance

### SessionManager

#### Methods

- `createSession(sessionId, pipeline, endpoint)`: Create a new session
- `getSession(sessionId)`: Get session by ID
- `removeSession(sessionId)`: Remove session and clean up
- `queueCandidate(sessionId, candidate)`: Queue ICE candidate
- `getQueuedCandidates(sessionId)`: Get and clear queued candidates
- `hasSession(sessionId)`: Check if session exists
- `getAllSessions()`: Get all active sessions
- `cleanupExpiredSessions(maxAgeMs)`: Clean up expired sessions

### MediaPipelineManager

#### Methods

- `getKurentoClient()`: Get or create Kurento client
- `createPipeline()`: Create a media pipeline
- `createWebRtcEndpoint(pipeline)`: Create WebRTC endpoint
- `createFaceOverlayFilter(pipeline, options)`: Create face overlay filter
- `connectElements(source, sink, bidirectional?)`: Connect media elements
- `processOffer(endpoint, sdpOffer)`: Process SDP offer
- `gatherCandidates(endpoint)`: Start gathering ICE candidates
- `addIceCandidate(endpoint, candidate)`: Add ICE candidate

## 🧪 Testing

Run the test suite:

```bash
npm test
# or
npx vitest
```

The test suite includes:
- Unit tests for each component
- Integration tests for complete workflows
- Mock implementations for external dependencies

## 📊 WebSocket Protocol

### Client → Server Messages

```typescript
// Start session
{
  "id": "start",
  "sdpOffer": "..." // SDP offer string
}

// Stop session
{
  "id": "stop"
}

// ICE candidate
{
  "id": "onIceCandidate",
  "candidate": {...} // ICE candidate object
}
```

### Server → Client Messages

```typescript
// Start response
{
  "id": "startResponse",
  "sdpAnswer": "..." // SDP answer string
}

// ICE candidate
{
  "id": "iceCandidate",
  "candidate": {...} // ICE candidate object
}

// Error
{
  "id": "error",
  "message": "..." // Error message
}
```

## 🎯 Use Cases

### 1. Video Conferencing
```typescript
const server = createWebRTCServer({
  asUri: 'https://conference.example.com/',
  wsUri: 'ws://kurento:8888/kurento',
});
```

### 2. Live Streaming with Filters
```typescript
const server = createWebRTCServer({
  asUri: 'https://stream.example.com/',
  wsUri: 'ws://kurento:8888/kurento',
  overlayUri: 'http://cdn.example.com/watermark.png',
});
```

### 3. WebRTC Gateway with STUNner
```typescript
const server = createWebRTCServerWithStunner(
  serverConfig,
  stunnerConfig
);
```

## 🔐 Security Considerations

1. **SSL/TLS**: Always use HTTPS in production
2. **Session Management**: Implement proper session authentication
3. **CORS**: Configure appropriate CORS policies
4. **Rate Limiting**: Implement rate limiting for WebSocket connections
5. **Input Validation**: Validate all incoming WebSocket messages

## 🚦 Production Deployment

### Health Monitoring

The example implementation includes health check endpoints:

- `GET /health`: Server health status
- `GET /api/sessions`: Active sessions information
- `GET /api/ice-config`: Current ICE configuration

### Graceful Shutdown

```typescript
process.on('SIGINT', async () => {
  await server.stop();
  process.exit(0);
});
```

### Session Cleanup

```typescript
// Clean up sessions older than 1 hour
setInterval(() => {
  sessionManager.cleanupExpiredSessions(60 * 60 * 1000);
}, 5 * 60 * 1000); // Check every 5 minutes
```

## 📈 Performance Optimization

1. **Connection Pooling**: Reuse Kurento client connections
2. **Session Caching**: Efficient session management with Map
3. **Async/Await**: Modern async patterns for better performance
4. **Event-Driven**: Use EventEmitter for decoupled communication

## 🤝 Contributing

When extending this implementation:

1. Follow the existing architectural patterns
2. Add comprehensive TypeScript types
3. Include unit tests for new features
4. Update documentation
5. Use meaningful commit messages

## 📄 License

This implementation is based on the Kurento tutorials and follows the Apache License 2.0.

## 🔗 References

- [Kurento Documentation](https://doc-kurento.readthedocs.io/)
- [WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [STUNner Documentation](https://github.com/l7mp/stunner)
- [Express.js](https://expressjs.com/)
- [ws WebSocket Library](https://github.com/websockets/ws)