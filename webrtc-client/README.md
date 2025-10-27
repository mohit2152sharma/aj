# WebRTC Client - TypeScript Implementation

A modern, modular, and composable WebRTC client written in TypeScript, inspired by the Kurento Magic Mirror tutorial. This implementation provides a clean architecture with separated concerns for signaling, media handling, state management, and UI control.

## Features

- 🎥 **WebRTC Video/Audio Communication** - Full duplex audio and video streaming
- 📡 **WebSocket Signaling** - Reliable signaling with automatic reconnection
- 🎛️ **State Management** - Centralized state management with event-driven updates
- 🎨 **Modern UI** - Responsive Bootstrap 5 interface with dark theme
- ⌨️ **Keyboard Shortcuts** - Quick access to common functions
- 📊 **Real-time Statistics** - Connection quality metrics and monitoring
- 🔧 **Configurable Settings** - Runtime configuration of ICE servers and media quality
- 📱 **Responsive Design** - Works on desktop and mobile devices

## Architecture

The client is built with a modular architecture consisting of:

### Core Components

1. **WebRTCClient** (`src/components/WebRTCClient.ts`)
   - Main client class managing peer connections
   - Handles SDP offer/answer exchange
   - Manages ICE candidate gathering and exchange

2. **SignalingService** (`src/services/SignalingService.ts`)
   - WebSocket connection management
   - Message queuing and delivery
   - Automatic reconnection with exponential backoff

3. **MediaHandler** (`src/services/MediaHandler.ts`)
   - Local and remote stream management
   - Media device access and constraints
   - Audio/video mute controls

4. **StateManager** (`src/services/StateManager.ts`)
   - Centralized state management
   - State change notifications
   - State history tracking

5. **UIController** (`src/components/UIController.ts`)
   - UI element management
   - User interaction handling
   - Console logging and feedback

## Installation

1. Clone or download the project
2. Install dependencies:
   ```bash
   cd webrtc-client
   npm install
   ```

## Development

1. Build the TypeScript files:
   ```bash
   npm run build
   ```

2. Watch for changes (development mode):
   ```bash
   npm run watch
   ```

3. Serve the application:
   ```bash
   npm run serve
   ```

4. Or run everything at once:
   ```bash
   npm run dev
   ```

The application will be available at `http://localhost:8080`

## Configuration

### WebSocket URL
Configure the WebSocket URL in the settings panel or modify the default in `src/main.ts`:
```typescript
wsUrl: 'wss://your-server:8443/magicmirror'
```

### ICE Servers
Configure STUN/TURN servers in the settings panel:
```json
[
  {"urls": "stun:stun.l.google.com:19302"},
  {"urls": "turn:your-turn-server.com", "username": "user", "credential": "pass"}
]
```

### Media Constraints
Adjust video quality presets in the settings panel:
- Low (480p)
- Medium (720p)
- High (1080p)
- Ultra (4K)

## Usage

1. **Connect** - Click "Connect" to establish WebSocket connection
2. **Start Call** - Click "Start Call" to begin WebRTC session
3. **Media Controls** - Use audio/video mute buttons during call
4. **Stop Call** - Click "Stop Call" to end the session
5. **Disconnect** - Click "Disconnect" to close WebSocket connection

### Keyboard Shortcuts

- `Ctrl+S` - Start/Stop call
- `M` - Toggle audio mute
- `V` - Toggle video
- `F` - Toggle fullscreen
- `Esc` - Exit fullscreen
- `Shift+?` - Show keyboard shortcuts

## API Usage

### Creating a Client

```typescript
import { WebRTCClient } from './components/WebRTCClient';
import { ClientOptions } from './types';

const options: ClientOptions = {
  wsUrl: 'wss://localhost:8443/magicmirror',
  localVideoElement: 'localVideo',
  remoteVideoElement: 'remoteVideo',
  iceConfiguration: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ]
  },
  mediaConstraints: {
    video: { width: 1280, height: 720 },
    audio: true
  },
  debug: true
};

const client = new WebRTCClient(options);
```

### Starting a Connection

```typescript
// Connect to signaling server
await client.connect();

// Start WebRTC call
await client.start();

// Stop call
client.stop();

// Disconnect from server
client.disconnect();
```

### Media Controls

```typescript
// Toggle audio
client.toggleAudio(false); // mute
client.toggleAudio(true);  // unmute

// Toggle video
client.toggleVideo(false); // disable
client.toggleVideo(true);  // enable

// Get media stats
const stats = client.getMediaStats();
console.log(stats);
```

### State Management

```typescript
// Get current state
const state = client.getConnectionState();

// Check if connected
if (client.isConnected()) {
  console.log('Client is connected');
}
```

## Project Structure

```
webrtc-client/
├── src/
│   ├── components/
│   │   ├── WebRTCClient.ts    # Main WebRTC client
│   │   └── UIController.ts     # UI management
│   ├── services/
│   │   ├── SignalingService.ts # WebSocket signaling
│   │   ├── MediaHandler.ts     # Media stream handling
│   │   └── StateManager.ts     # State management
│   ├── types/
│   │   └── index.ts            # TypeScript type definitions
│   └── main.ts                 # Application entry point
├── public/
│   ├── index.html              # Main HTML file
│   ├── css/
│   │   └── styles.css          # Custom styles
│   └── img/                    # Images and assets
├── package.json                # NPM configuration
├── tsconfig.json              # TypeScript configuration
└── README.md                  # This file
```

## Browser Support

- Chrome 65+
- Firefox 60+
- Safari 12+
- Edge 79+

## Security Considerations

- Always use HTTPS/WSS in production
- Implement proper authentication for WebSocket connections
- Validate and sanitize all signaling messages
- Use TURN servers for NAT traversal
- Enable CORS appropriately on the server

## Troubleshooting

### Connection Issues
- Verify WebSocket URL is correct
- Check firewall settings for WebSocket ports
- Ensure SSL certificates are valid for WSS connections

### Media Issues
- Grant camera/microphone permissions when prompted
- Check browser console for getUserMedia errors
- Verify media constraints are supported by your devices

### Performance Issues
- Lower video quality in settings
- Check network bandwidth and latency
- Monitor CPU usage during calls

## License

Apache License 2.0

## Contributing

Contributions are welcome! Please follow the TypeScript style guide and ensure all code is properly typed.

## Credits

Inspired by the [Kurento Magic Mirror Tutorial](https://github.com/l7mp/kurento-tutorial-node/tree/master/kurento-magic-mirror)