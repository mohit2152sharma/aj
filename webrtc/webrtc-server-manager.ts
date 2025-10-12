/**
 * WebRTC Server Connection Manager
 * Manages WebRTC connections, sessions, and media pipelines using Kurento Media Server
 * 
 * This module provides a modular, composable architecture for handling WebRTC connections
 * with support for STUNner integration and media processing pipelines.
 */

import * as express from 'express';
import * as ws from 'ws';
import * as kurento from 'kurento-client';
import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * ICE server configuration following W3C RTCIceServer specification
 */
export interface IceConfiguration {
  urls: string | string[];
  username?: string;
  credential?: string;
  credentialType?: 'password' | 'oauth';
}

/**
 * STUNner query parameters for ICE configuration
 */
export interface StunnerQueryParams {
  service: string;
  username: string;
  iceTransportPolicy?: string;
  namespace?: string;
  gateway?: string;
  listener?: string;
}

/**
 * Configuration for STUNner authentication service
 */
export interface StunnerConfig {
  authAddress: string;
  authPort: string;
  namespace?: string;
  gateway?: string;
  listener?: string;
}

/**
 * WebRTC session information
 */
export interface WebRTCSession {
  pipeline: any; // kurento.MediaPipeline
  webRtcEndpoint: any; // kurento.WebRtcEndpoint
  sessionId: string;
  createdAt: Date;
}

/**
 * WebSocket message structure
 */
export interface WebSocketMessage {
  id: string;
  sdpOffer?: string;
  sdpAnswer?: string;
  candidate?: any;
  message?: string;
}

/**
 * Server configuration options
 */
export interface ServerConfig {
  asUri: string;
  wsUri: string;
  overlayUri?: string;
  sslKey?: string;
  sslCert?: string;
}

/**
 * Media element creation options
 */
export interface MediaElementOptions {
  overlayImage?: {
    uri: string;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
  };
}

// ============================================================================
// ICE Configuration Manager
// ============================================================================

/**
 * Manages ICE configuration and STUNner integration
 */
export class IceConfigurationManager extends EventEmitter {
  private iceConfiguration: IceConfiguration | null = null;
  private stunnerConfig: StunnerConfig;
  private updateInterval: NodeJS.Timeout | null = null;
  private templateFile: string;
  private clientFile: string;

  constructor(stunnerConfig: StunnerConfig, templateFile?: string, clientFile?: string) {
    super();
    this.stunnerConfig = this.loadStunnerConfig(stunnerConfig);
    this.templateFile = templateFile || 'static/js/index.js.template';
    this.clientFile = clientFile || 'static/js/index.js';
  }

  /**
   * Load STUNner configuration from environment variables or defaults
   */
  private loadStunnerConfig(config: StunnerConfig): StunnerConfig {
    return {
      authAddress: process.env.STUNNER_AUTH_ADDR || config.authAddress,
      authPort: process.env.STUNNER_AUTH_PORT || config.authPort,
      namespace: process.env.STUNNER_NAMESPACE || config.namespace,
      gateway: process.env.STUNNER_GATEWAY || config.gateway,
      listener: process.env.STUNNER_LISTENER || config.listener,
    };
  }

  /**
   * Build query options for ICE configuration request
   */
  private buildQueryOptions(username: string): http.RequestOptions {
    const query: StunnerQueryParams = {
      service: 'turn',
      username,
      iceTransportPolicy: 'relay',
    };

    // Add optional parameters if configured
    if (this.stunnerConfig.namespace) query.namespace = this.stunnerConfig.namespace;
    if (this.stunnerConfig.gateway) query.gateway = this.stunnerConfig.gateway;
    if (this.stunnerConfig.listener) query.listener = this.stunnerConfig.listener;

    return {
      host: this.stunnerConfig.authAddress,
      port: this.stunnerConfig.authPort,
      method: 'GET',
      path: url.format({ pathname: '/ice', query: query as any }),
    };
  }

  /**
   * Query ICE configuration from STUNner auth service
   */
  public async queryIceConfiguration(username: string): Promise<IceConfiguration | null> {
    return new Promise((resolve, reject) => {
      const options = this.buildQueryOptions(username);
      
      const request = http.request(options, (res) => {
        let response = '';
        
        res.on('data', (chunk) => {
          response += chunk;
        });
        
        res.on('end', () => {
          try {
            const iceConfig = JSON.parse(response);
            this.iceConfiguration = iceConfig;
            this.emit('iceConfigUpdated', iceConfig);
            resolve(iceConfig);
          } catch (error) {
            reject(new Error(`Failed to parse ICE configuration: ${error}`));
          }
        });
        
        res.on('error', (err) => {
          reject(new Error(`HTTP response error: ${err}`));
        });
      });
      
      request.on('error', (err) => {
        reject(new Error(`HTTP request error: ${err}`));
      });
      
      request.end();
    });
  }

  /**
   * Update client-side JavaScript file with ICE configuration
   */
  private async updateClientFile(): Promise<void> {
    if (!this.iceConfiguration) return;

    try {
      // Copy template file
      await fs.promises.copyFile(this.templateFile, this.clientFile);
      
      // Read and update the file
      let data = await fs.promises.readFile(this.clientFile, 'utf-8');
      data = data.replace('XXXXXX', JSON.stringify(this.iceConfiguration));
      await fs.promises.writeFile(this.clientFile, data, 'utf-8');
      
      console.log('Updated client file with ICE configuration:', JSON.stringify(this.iceConfiguration));
    } catch (error) {
      console.error('Failed to update client file:', error);
      throw error;
    }
  }

  /**
   * Start periodic ICE configuration updates
   */
  public startPeriodicUpdates(intervalMs: number = 5000, username: string = 'user-1'): void {
    this.stopPeriodicUpdates(); // Clear any existing interval
    
    const updateTask = async () => {
      try {
        await this.queryIceConfiguration(username);
        await this.updateClientFile();
      } catch (error) {
        console.error('Failed to update ICE configuration:', error);
      }
    };
    
    // Initial update
    updateTask();
    
    // Set up periodic updates
    this.updateInterval = setInterval(updateTask, intervalMs);
  }

  /**
   * Stop periodic ICE configuration updates
   */
  public stopPeriodicUpdates(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Get current ICE configuration
   */
  public getConfiguration(): IceConfiguration | null {
    return this.iceConfiguration;
  }
}

// ============================================================================
// Session Manager
// ============================================================================

/**
 * Manages WebRTC sessions and ICE candidates queue
 */
export class SessionManager {
  private sessions: Map<string, WebRTCSession> = new Map();
  private candidatesQueue: Map<string, any[]> = new Map();

  /**
   * Create a new session
   */
  public createSession(sessionId: string, pipeline: any, webRtcEndpoint: any): WebRTCSession {
    const session: WebRTCSession = {
      sessionId,
      pipeline,
      webRtcEndpoint,
      createdAt: new Date(),
    };
    
    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Get session by ID
   */
  public getSession(sessionId: string): WebRTCSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Remove session and clean up resources
   */
  public removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      console.info(`Releasing pipeline for session ${sessionId}`);
      session.pipeline.release();
      this.sessions.delete(sessionId);
      this.candidatesQueue.delete(sessionId);
    }
  }

  /**
   * Queue ICE candidate for a session
   */
  public queueCandidate(sessionId: string, candidate: any): void {
    if (!this.candidatesQueue.has(sessionId)) {
      this.candidatesQueue.set(sessionId, []);
    }
    this.candidatesQueue.get(sessionId)!.push(candidate);
  }

  /**
   * Get and clear queued candidates for a session
   */
  public getQueuedCandidates(sessionId: string): any[] {
    const candidates = this.candidatesQueue.get(sessionId) || [];
    this.candidatesQueue.delete(sessionId);
    return candidates;
  }

  /**
   * Check if session exists
   */
  public hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Get all active sessions
   */
  public getAllSessions(): WebRTCSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Clean up expired sessions (optional)
   */
  public cleanupExpiredSessions(maxAgeMs: number): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.createdAt.getTime() > maxAgeMs) {
        this.removeSession(sessionId);
      }
    }
  }
}

// ============================================================================
// Kurento Media Pipeline Manager
// ============================================================================

/**
 * Manages Kurento media pipelines and elements
 */
export class MediaPipelineManager {
  private kurentoClient: any | null = null;
  private kurentoUri: string;

  constructor(kurentoUri: string) {
    this.kurentoUri = kurentoUri;
  }

  /**
   * Get or create Kurento client
   */
  public async getKurentoClient(): Promise<any> {
    if (this.kurentoClient) {
      return this.kurentoClient;
    }

    return new Promise((resolve, reject) => {
      kurento(this.kurentoUri, (error: any, client: any) => {
        if (error) {
          const errorMsg = `Could not find media server at address ${this.kurentoUri}: ${error}`;
          console.error(errorMsg);
          reject(new Error(errorMsg));
          return;
        }
        
        this.kurentoClient = client;
        resolve(client);
      });
    });
  }

  /**
   * Create a media pipeline
   */
  public async createPipeline(): Promise<any> {
    const client = await this.getKurentoClient();
    
    return new Promise((resolve, reject) => {
      client.create('MediaPipeline', (error: any, pipeline: any) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(pipeline);
      });
    });
  }

  /**
   * Create WebRTC endpoint
   */
  public async createWebRtcEndpoint(pipeline: any): Promise<any> {
    return new Promise((resolve, reject) => {
      pipeline.create('WebRtcEndpoint', (error: any, endpoint: any) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(endpoint);
      });
    });
  }

  /**
   * Create face overlay filter
   */
  public async createFaceOverlayFilter(pipeline: any, overlayOptions: MediaElementOptions['overlayImage']): Promise<any> {
    return new Promise((resolve, reject) => {
      pipeline.create('FaceOverlayFilter', (error: any, filter: any) => {
        if (error) {
          reject(error);
          return;
        }

        if (overlayOptions) {
          filter.setOverlayedImage(
            overlayOptions.uri,
            overlayOptions.offsetX,
            overlayOptions.offsetY,
            overlayOptions.width,
            overlayOptions.height,
            (error: any) => {
              if (error) {
                reject(error);
                return;
              }
              resolve(filter);
            }
          );
        } else {
          resolve(filter);
        }
      });
    });
  }

  /**
   * Connect media elements in a pipeline
   */
  public async connectElements(source: any, sink: any, bidirectional: boolean = false): Promise<void> {
    return new Promise((resolve, reject) => {
      source.connect(sink, (error: any) => {
        if (error) {
          reject(error);
          return;
        }

        if (bidirectional) {
          sink.connect(source, (error: any) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Process SDP offer and generate answer
   */
  public async processOffer(webRtcEndpoint: any, sdpOffer: string): Promise<string> {
    return new Promise((resolve, reject) => {
      webRtcEndpoint.processOffer(sdpOffer, (error: any, sdpAnswer: string) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(sdpAnswer);
      });
    });
  }

  /**
   * Start gathering ICE candidates
   */
  public async gatherCandidates(webRtcEndpoint: any): Promise<void> {
    return new Promise((resolve, reject) => {
      webRtcEndpoint.gatherCandidates((error: any) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  /**
   * Add ICE candidate to endpoint
   */
  public addIceCandidate(webRtcEndpoint: any, candidate: any): void {
    const iceCandidate = kurento.getComplexType('IceCandidate')(candidate);
    webRtcEndpoint.addIceCandidate(iceCandidate);
  }

  /**
   * Disconnect and clean up
   */
  public disconnect(): void {
    if (this.kurentoClient) {
      this.kurentoClient = null;
    }
  }
}

// ============================================================================
// WebSocket Connection Handler
// ============================================================================

/**
 * Handles WebSocket connections and message routing
 */
export class WebSocketHandler extends EventEmitter {
  private sessionManager: SessionManager;
  private pipelineManager: MediaPipelineManager;
  private mediaOptions: MediaElementOptions;

  constructor(
    sessionManager: SessionManager,
    pipelineManager: MediaPipelineManager,
    mediaOptions: MediaElementOptions = {}
  ) {
    super();
    this.sessionManager = sessionManager;
    this.pipelineManager = pipelineManager;
    this.mediaOptions = mediaOptions;
  }

  /**
   * Handle WebSocket connection
   */
  public handleConnection(ws: ws.WebSocket, sessionId: string): void {
    console.log(`Connection received with sessionId ${sessionId}`);

    ws.on('error', (error) => {
      console.error(`Connection ${sessionId} error:`, error);
      this.handleStop(sessionId);
    });

    ws.on('close', () => {
      console.log(`Connection ${sessionId} closed`);
      this.handleStop(sessionId);
    });

    ws.on('message', (data) => {
      this.handleMessage(ws, sessionId, data.toString());
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  private async handleMessage(ws: ws.WebSocket, sessionId: string, rawMessage: string): Promise<void> {
    try {
      const message: WebSocketMessage = JSON.parse(rawMessage);
      console.log(`Connection ${sessionId} received message:`, message);

      switch (message.id) {
        case 'start':
          await this.handleStart(ws, sessionId, message.sdpOffer!);
          break;

        case 'stop':
          this.handleStop(sessionId);
          break;

        case 'onIceCandidate':
          this.handleIceCandidate(sessionId, message.candidate);
          break;

        default:
          this.sendError(ws, `Invalid message: ${message.id}`);
          break;
      }
    } catch (error) {
      console.error(`Error handling message for session ${sessionId}:`, error);
      this.sendError(ws, `Error processing message: ${error}`);
    }
  }

  /**
   * Handle start message - create media pipeline and establish connection
   */
  private async handleStart(ws: ws.WebSocket, sessionId: string, sdpOffer: string): Promise<void> {
    if (!sessionId) {
      this.sendError(ws, 'Cannot use undefined sessionId');
      return;
    }

    try {
      // Create media pipeline
      const pipeline = await this.pipelineManager.createPipeline();

      try {
        // Create media elements
        const webRtcEndpoint = await this.pipelineManager.createWebRtcEndpoint(pipeline);
        
        let processingElement = webRtcEndpoint;
        
        // Create optional face overlay filter
        if (this.mediaOptions.overlayImage) {
          const faceOverlayFilter = await this.pipelineManager.createFaceOverlayFilter(
            pipeline,
            this.mediaOptions.overlayImage
          );
          
          // Connect WebRTC endpoint -> Filter -> WebRTC endpoint
          await this.pipelineManager.connectElements(webRtcEndpoint, faceOverlayFilter);
          await this.pipelineManager.connectElements(faceOverlayFilter, webRtcEndpoint);
          
          processingElement = faceOverlayFilter;
        }

        // Process queued candidates
        const queuedCandidates = this.sessionManager.getQueuedCandidates(sessionId);
        for (const candidate of queuedCandidates) {
          this.pipelineManager.addIceCandidate(webRtcEndpoint, candidate);
        }

        // Set up ICE candidate handler
        webRtcEndpoint.on('IceCandidateFound', (event: any) => {
          const candidate = kurento.getComplexType('IceCandidate')(event.candidate);
          ws.send(JSON.stringify({
            id: 'iceCandidate',
            candidate: candidate,
          }));
        });

        // Process SDP offer and generate answer
        const sdpAnswer = await this.pipelineManager.processOffer(webRtcEndpoint, sdpOffer);

        // Create session
        this.sessionManager.createSession(sessionId, pipeline, webRtcEndpoint);

        // Send SDP answer
        ws.send(JSON.stringify({
          id: 'startResponse',
          sdpAnswer: sdpAnswer,
        }));

        // Start gathering ICE candidates
        await this.pipelineManager.gatherCandidates(webRtcEndpoint);

        this.emit('sessionStarted', sessionId);
      } catch (error) {
        pipeline.release();
        throw error;
      }
    } catch (error) {
      console.error(`Failed to start session ${sessionId}:`, error);
      this.sendError(ws, `Failed to start session: ${error}`);
    }
  }

  /**
   * Handle stop message - clean up session
   */
  private handleStop(sessionId: string): void {
    this.sessionManager.removeSession(sessionId);
    this.emit('sessionStopped', sessionId);
  }

  /**
   * Handle ICE candidate message
   */
  private handleIceCandidate(sessionId: string, candidate: any): void {
    const session = this.sessionManager.getSession(sessionId);
    
    if (session) {
      console.info('Sending candidate to endpoint');
      this.pipelineManager.addIceCandidate(session.webRtcEndpoint, candidate);
    } else {
      console.info('Queueing candidate');
      this.sessionManager.queueCandidate(sessionId, candidate);
    }
  }

  /**
   * Send error message to client
   */
  private sendError(ws: ws.WebSocket, message: string): void {
    ws.send(JSON.stringify({
      id: 'error',
      message: message,
    }));
  }
}

// ============================================================================
// Main WebRTC Server Manager
// ============================================================================

/**
 * Main class for managing the WebRTC server
 */
export class WebRTCServerManager {
  private config: ServerConfig;
  private app: express.Application;
  private server: https.Server | http.Server;
  private wss: ws.Server;
  private sessionManager: SessionManager;
  private pipelineManager: MediaPipelineManager;
  private iceManager: IceConfigurationManager | null = null;
  private wsHandler: WebSocketHandler;

  constructor(config: ServerConfig) {
    this.config = config;
    this.app = express();
    this.sessionManager = new SessionManager();
    this.pipelineManager = new MediaPipelineManager(config.wsUri);
    
    // Initialize WebSocket handler with optional overlay
    const mediaOptions: MediaElementOptions = {};
    if (config.overlayUri) {
      mediaOptions.overlayImage = {
        uri: config.overlayUri,
        offsetX: -0.35,
        offsetY: -1.2,
        width: 1.6,
        height: 1.6,
      };
    }
    
    this.wsHandler = new WebSocketHandler(
      this.sessionManager,
      this.pipelineManager,
      mediaOptions
    );

    // Create server (HTTPS or HTTP)
    if (config.sslKey && config.sslCert) {
      const options = {
        key: fs.readFileSync(config.sslKey),
        cert: fs.readFileSync(config.sslCert),
      };
      this.server = https.createServer(options, this.app);
    } else {
      this.server = http.createServer(this.app);
    }

    // Create WebSocket server
    this.wss = new ws.Server({
      server: this.server,
      path: '/magicmirror',
    });
  }

  /**
   * Initialize STUNner integration
   */
  public initializeStunner(stunnerConfig: StunnerConfig, templateFile?: string, clientFile?: string): void {
    this.iceManager = new IceConfigurationManager(stunnerConfig, templateFile, clientFile);
    this.iceManager.startPeriodicUpdates();
  }

  /**
   * Set up WebSocket connection handling
   */
  private setupWebSocketHandling(sessionHandler?: any): void {
    this.wss.on('connection', (ws: ws.WebSocket, req: http.IncomingMessage) => {
      let sessionId: string;
      
      if (sessionHandler) {
        // Use session handler if provided
        const request = req as any;
        const response = { writeHead: {} };
        
        sessionHandler(request, response, (err: any) => {
          sessionId = request.session.id;
          this.wsHandler.handleConnection(ws, sessionId);
        });
      } else {
        // Generate simple session ID
        sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.wsHandler.handleConnection(ws, sessionId);
      }
    });
  }

  /**
   * Set up Express middleware
   */
  public setupMiddleware(sessionHandler?: any): void {
    // Serve static files
    this.app.use(express.static(path.join(__dirname, 'static')));
    
    // Set up WebSocket handling
    this.setupWebSocketHandling(sessionHandler);
  }

  /**
   * Start the server
   */
  public async start(): Promise<void> {
    const asUrl = url.parse(this.config.asUri);
    const port = asUrl.port || (asUrl.protocol === 'https:' ? 443 : 80);
    
    return new Promise((resolve) => {
      this.server.listen(port, () => {
        console.log('WebRTC Server Manager started');
        console.log(`Server listening on ${this.config.asUri}`);
        console.log(`WebSocket endpoint: ${this.config.asUri}magicmirror`);
        console.log(`Kurento Media Server: ${this.config.wsUri}`);
        
        if (this.config.overlayUri) {
          console.log(`Overlay image URI: ${this.config.overlayUri}`);
        }
        
        resolve();
      });
    });
  }

  /**
   * Stop the server and clean up resources
   */
  public async stop(): Promise<void> {
    // Stop ICE configuration updates
    if (this.iceManager) {
      this.iceManager.stopPeriodicUpdates();
    }

    // Close all WebSocket connections
    this.wss.clients.forEach((client) => {
      client.close();
    });

    // Clean up all sessions
    const sessions = this.sessionManager.getAllSessions();
    for (const session of sessions) {
      this.sessionManager.removeSession(session.sessionId);
    }

    // Disconnect from Kurento
    this.pipelineManager.disconnect();

    // Close server
    return new Promise((resolve) => {
      this.server.close(() => {
        console.log('WebRTC Server Manager stopped');
        resolve();
      });
    });
  }

  /**
   * Get session manager instance
   */
  public getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  /**
   * Get pipeline manager instance
   */
  public getPipelineManager(): MediaPipelineManager {
    return this.pipelineManager;
  }

  /**
   * Get ICE configuration manager instance
   */
  public getIceManager(): IceConfigurationManager | null {
    return this.iceManager;
  }

  /**
   * Get WebSocket handler instance
   */
  public getWebSocketHandler(): WebSocketHandler {
    return this.wsHandler;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a WebRTC server with default configuration
 */
export function createWebRTCServer(config: ServerConfig): WebRTCServerManager {
  return new WebRTCServerManager(config);
}

/**
 * Create a WebRTC server with STUNner integration
 */
export function createWebRTCServerWithStunner(
  serverConfig: ServerConfig,
  stunnerConfig: StunnerConfig
): WebRTCServerManager {
  const server = new WebRTCServerManager(serverConfig);
  server.initializeStunner(stunnerConfig);
  return server;
}

// ============================================================================
// Example Usage
// ============================================================================

/**
 * Example of how to use the WebRTC Server Manager
 * 
 * @example
 * ```typescript
 * import { createWebRTCServerWithStunner } from './webrtc-server-manager';
 * 
 * const serverConfig = {
 *   asUri: 'https://localhost:8443/',
 *   wsUri: 'ws://localhost:8888/kurento',
 *   overlayUri: 'http://overlay-image.default.svc.cluster.local:80/img/mario-wings.png',
 *   sslKey: 'keys/server.key',
 *   sslCert: 'keys/server.crt',
 * };
 * 
 * const stunnerConfig = {
 *   authAddress: 'stunner-auth.stunner-system.svc.cluster.local',
 *   authPort: '8088',
 * };
 * 
 * const server = createWebRTCServerWithStunner(serverConfig, stunnerConfig);
 * 
 * // Set up session handling
 * import * as session from 'express-session';
 * const sessionHandler = session({
 *   secret: 'your-secret-key',
 *   rolling: true,
 *   resave: true,
 *   saveUninitialized: true,
 * });
 * 
 * server.setupMiddleware(sessionHandler);
 * 
 * // Start the server
 * server.start().then(() => {
 *   console.log('Server is running');
 * });
 * 
 * // Graceful shutdown
 * process.on('SIGINT', async () => {
 *   await server.stop();
 *   process.exit(0);
 * });
 * ```
 */