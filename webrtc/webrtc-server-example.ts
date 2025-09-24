/**
 * Example implementation of the WebRTC Server Manager
 * 
 * This file demonstrates how to use the modular WebRTC server components
 * to create a fully functional WebRTC server with Kurento Media Server integration.
 */

import * as express from 'express';
import * as session from 'express-session';
import * as cookieParser from 'cookie-parser';
import * as minimist from 'minimist';
import * as path from 'path';
import * as http from 'http';
import {
  createWebRTCServerWithStunner,
  WebRTCServerManager,
  ServerConfig,
  StunnerConfig,
} from './webrtc-server-manager';

// ============================================================================
// Configuration
// ============================================================================

// Parse command-line arguments
const argv = minimist(process.argv.slice(2), {
  default: {
    as_uri: 'https://localhost:8443/',
    ws_uri: 'ws://localhost:8888/kurento',
    overlay_uri: 'http://overlay-image.default.svc.cluster.local:80/img/mario-wings.png',
  },
});

// Server configuration
const serverConfig: ServerConfig = {
  asUri: argv.as_uri,
  wsUri: argv.ws_uri,
  overlayUri: argv.overlay_uri,
  sslKey: 'keys/server.key',
  sslCert: 'keys/server.crt',
};

// STUNner configuration
const stunnerConfig: StunnerConfig = {
  authAddress: 'stunner-auth.stunner-system.svc.cluster.local',
  authPort: '8088',
};

// ============================================================================
// Overlay Image Server (Optional)
// ============================================================================

/**
 * Create a simple HTTP server to serve overlay images
 * This is optional and only needed if you're serving overlay images locally
 */
function createOverlayImageServer(port: number = 80): http.Server {
  const server = http.createServer((req, res) => {
    const fs = require('fs');
    const file = path.join(__dirname, 'static', req.url || '');
    
    console.log('Serving overlay image:', file);
    
    fs.readFile(file, (err: any, data: Buffer) => {
      if (err) {
        res.writeHead(404);
        res.end(JSON.stringify(err));
        return;
      }
      res.writeHead(200);
      res.end(data);
    });
  });
  
  server.listen(port, () => {
    console.log(`Overlay image server listening on port ${port}`);
  });
  
  return server;
}

// ============================================================================
// Main Application
// ============================================================================

class WebRTCApplication {
  private server: WebRTCServerManager;
  private overlayServer?: http.Server;
  private sessionHandler: express.RequestHandler;

  constructor() {
    // Create the WebRTC server with STUNner integration
    this.server = createWebRTCServerWithStunner(serverConfig, stunnerConfig);
    
    // Configure session handling
    this.sessionHandler = session({
      secret: 'your-secret-key-change-in-production',
      rolling: true,
      resave: true,
      saveUninitialized: true,
      cookie: {
        secure: serverConfig.asUri.startsWith('https'),
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      },
    });
  }

  /**
   * Initialize the application
   */
  public async initialize(): Promise<void> {
    // Set up Express middleware
    this.setupExpressMiddleware();
    
    // Set up WebSocket handling with session support
    this.server.setupMiddleware(this.sessionHandler);
    
    // Set up event listeners
    this.setupEventListeners();
    
    // Optionally start overlay image server
    if (process.env.SERVE_OVERLAY_IMAGES === 'true') {
      this.overlayServer = createOverlayImageServer();
    }
  }

  /**
   * Set up Express middleware
   */
  private setupExpressMiddleware(): void {
    const app = (this.server as any).app;
    
    // Cookie parser
    app.use(cookieParser());
    
    // Session handler
    app.use(this.sessionHandler);
    
    // Health check endpoint
    app.get('/health', (req: express.Request, res: express.Response) => {
      const sessionManager = this.server.getSessionManager();
      const sessions = sessionManager.getAllSessions();
      
      res.json({
        status: 'healthy',
        activeSessions: sessions.length,
        timestamp: new Date().toISOString(),
      });
    });
    
    // Session info endpoint
    app.get('/api/sessions', (req: express.Request, res: express.Response) => {
      const sessionManager = this.server.getSessionManager();
      const sessions = sessionManager.getAllSessions();
      
      res.json({
        sessions: sessions.map(s => ({
          sessionId: s.sessionId,
          createdAt: s.createdAt,
        })),
      });
    });
    
    // ICE configuration endpoint
    app.get('/api/ice-config', async (req: express.Request, res: express.Response) => {
      const iceManager = this.server.getIceManager();
      
      if (!iceManager) {
        res.status(503).json({ error: 'ICE configuration not available' });
        return;
      }
      
      const config = iceManager.getConfiguration();
      if (config) {
        res.json(config);
      } else {
        res.status(503).json({ error: 'ICE configuration not yet retrieved' });
      }
    });
  }

  /**
   * Set up event listeners for WebSocket handler
   */
  private setupEventListeners(): void {
    const wsHandler = this.server.getWebSocketHandler();
    
    wsHandler.on('sessionStarted', (sessionId: string) => {
      console.log(`✅ Session started: ${sessionId}`);
      this.logActiveSessions();
    });
    
    wsHandler.on('sessionStopped', (sessionId: string) => {
      console.log(`❌ Session stopped: ${sessionId}`);
      this.logActiveSessions();
    });
    
    // ICE configuration updates
    const iceManager = this.server.getIceManager();
    if (iceManager) {
      iceManager.on('iceConfigUpdated', (config: any) => {
        console.log('📡 ICE configuration updated:', JSON.stringify(config, null, 2));
      });
    }
  }

  /**
   * Log active sessions
   */
  private logActiveSessions(): void {
    const sessionManager = this.server.getSessionManager();
    const sessions = sessionManager.getAllSessions();
    console.log(`📊 Active sessions: ${sessions.length}`);
  }

  /**
   * Start the application
   */
  public async start(): Promise<void> {
    await this.initialize();
    await this.server.start();
    
    console.log('');
    console.log('='.repeat(60));
    console.log('🚀 WebRTC Server Application Started');
    console.log('='.repeat(60));
    console.log(`📍 Server URL: ${serverConfig.asUri}`);
    console.log(`🔌 WebSocket: ${serverConfig.asUri}magicmirror`);
    console.log(`🎥 Kurento: ${serverConfig.wsUri}`);
    if (serverConfig.overlayUri) {
      console.log(`🖼️  Overlay: ${serverConfig.overlayUri}`);
    }
    console.log('='.repeat(60));
    console.log('');
    
    // Start periodic session cleanup (clean sessions older than 1 hour)
    setInterval(() => {
      const sessionManager = this.server.getSessionManager();
      sessionManager.cleanupExpiredSessions(60 * 60 * 1000);
    }, 5 * 60 * 1000); // Check every 5 minutes
  }

  /**
   * Stop the application gracefully
   */
  public async stop(): Promise<void> {
    console.log('\n📛 Shutting down WebRTC Server Application...');
    
    // Stop overlay server if running
    if (this.overlayServer) {
      await new Promise<void>((resolve) => {
        this.overlayServer!.close(() => {
          console.log('Overlay server stopped');
          resolve();
        });
      });
    }
    
    // Stop main server
    await this.server.stop();
    
    console.log('✅ WebRTC Server Application stopped successfully');
  }
}

// ============================================================================
// Application Entry Point
// ============================================================================

// Create and start the application
const app = new WebRTCApplication();

// Start the server
app.start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

// Handle graceful shutdown
const shutdown = async () => {
  try {
    await app.stop();
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
};

// Register shutdown handlers
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  shutdown();
});

// Export for testing purposes
export { WebRTCApplication };