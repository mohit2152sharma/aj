/**
 * Main WebRTC client for managing peer connections
 */

import {
  ClientOptions,
  ConnectionState,
  WebRTCConfig,
  Logger,
  StartMessage,
  StopMessage,
  IceCandidateMessage,
  IncomingMessage,
  StartResponseMessage,
  ErrorMessage,
  IncomingIceCandidateMessage
} from '../types';
import { StateManager } from '../services/StateManager';
import { SignalingService } from '../services/SignalingService';
import { MediaHandler } from '../services/MediaHandler';

export class WebRTCClient {
  private peerConnection: RTCPeerConnection | null = null;
  private stateManager: StateManager;
  private signalingService: SignalingService;
  private mediaHandler: MediaHandler;
  private options: ClientOptions;
  private logger: Logger;
  private iceCandidateQueue: RTCIceCandidateInit[] = [];
  private statsInterval: NodeJS.Timeout | null = null;

  constructor(options: ClientOptions) {
    this.options = options;
    this.logger = this.createLogger();
    
    // Initialize services
    this.stateManager = new StateManager();
    this.signalingService = new SignalingService(options.wsUrl, this.logger);
    this.mediaHandler = new MediaHandler(
      this.stateManager,
      this.logger,
      options.mediaConstraints
    );

    // Set up video elements
    this.mediaHandler.setVideoElements(
      options.localVideoElement,
      options.remoteVideoElement
    );

    // Setup signaling event handlers
    this.setupSignalingHandlers();

    // Setup state change handlers
    this.setupStateHandlers();

    // Auto-connect if specified
    if (options.autoStart) {
      this.connect();
    }
  }

  /**
   * Connect to signaling server and prepare for calls
   */
  public async connect(): Promise<void> {
    try {
      this.logger.info('Connecting to signaling server');
      await this.signalingService.connect();
      this.stateManager.setConnectionState(ConnectionState.IDLE);
    } catch (error) {
      this.logger.error('Failed to connect:', error);
      this.stateManager.setConnectionState(ConnectionState.FAILED);
      throw error;
    }
  }

  /**
   * Start WebRTC connection
   */
  public async start(): Promise<void> {
    if (!this.stateManager.canStart()) {
      this.logger.warn('Cannot start in current state:', this.stateManager.getConnectionState());
      return;
    }

    try {
      this.stateManager.setConnectionState(ConnectionState.CONNECTING);
      this.logger.info('Starting WebRTC connection');

      // Start local media stream
      const localStream = await this.mediaHandler.startLocalStream();

      // Create peer connection
      this.createPeerConnection();

      // Add local stream tracks to peer connection
      if (this.peerConnection && localStream) {
        localStream.getTracks().forEach(track => {
          this.logger.debug(`Adding ${track.kind} track to peer connection`);
          this.peerConnection!.addTrack(track, localStream);
        });
      }

      // Create and send offer
      await this.createAndSendOffer();
    } catch (error) {
      this.logger.error('Failed to start:', error);
      this.stateManager.setConnectionState(ConnectionState.FAILED);
      this.cleanup();
      throw error;
    }
  }

  /**
   * Stop WebRTC connection
   */
  public stop(): void {
    if (!this.stateManager.canStop()) {
      this.logger.warn('Cannot stop in current state:', this.stateManager.getConnectionState());
      return;
    }

    this.logger.info('Stopping WebRTC connection');
    this.stateManager.setConnectionState(ConnectionState.DISCONNECTING);

    // Send stop message to server
    const stopMessage: StopMessage = { id: 'stop' };
    this.signalingService.send(stopMessage);

    // Cleanup resources
    this.cleanup();
    this.stateManager.setConnectionState(ConnectionState.DISCONNECTED);
  }

  /**
   * Disconnect from signaling server
   */
  public disconnect(): void {
    this.logger.info('Disconnecting from signaling server');
    this.stop();
    this.signalingService.disconnect();
    this.stateManager.reset();
  }

  /**
   * Get current connection state
   */
  public getConnectionState(): ConnectionState {
    return this.stateManager.getConnectionState();
  }

  /**
   * Check if client is connected
   */
  public isConnected(): boolean {
    return this.stateManager.isConnectionState(ConnectionState.CONNECTED);
  }

  /**
   * Toggle audio mute
   */
  public toggleAudio(enabled?: boolean): boolean {
    return this.mediaHandler.toggleAudio(enabled);
  }

  /**
   * Toggle video
   */
  public toggleVideo(enabled?: boolean): boolean {
    return this.mediaHandler.toggleVideo(enabled);
  }

  /**
   * Get media statistics
   */
  public getMediaStats() {
    return this.mediaHandler.getMediaStats();
  }

  /**
   * Get connection statistics
   */
  public async getConnectionStats(): Promise<RTCStatsReport | null> {
    if (!this.peerConnection) {
      return null;
    }
    return await this.peerConnection.getStats();
  }

  /**
   * Create peer connection
   */
  private createPeerConnection(): void {
    const config = this.options.iceConfiguration || this.getDefaultIceConfiguration();
    
    this.logger.info('Creating RTCPeerConnection with config:', config);
    this.peerConnection = new RTCPeerConnection(config);

    // Setup peer connection event handlers
    this.setupPeerConnectionHandlers();
  }

  /**
   * Setup peer connection event handlers
   */
  private setupPeerConnectionHandlers(): void {
    if (!this.peerConnection) return;

    // Handle ICE candidates
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.logger.debug('Local ICE candidate:', event.candidate);
        const message: IceCandidateMessage = {
          id: 'onIceCandidate',
          candidate: event.candidate
        };
        this.signalingService.send(message);
      }
    };

    // Handle remote stream
    this.peerConnection.ontrack = (event) => {
      this.logger.info('Received remote track:', event.track.kind);
      if (event.streams && event.streams[0]) {
        this.mediaHandler.setRemoteStream(event.streams[0]);
      }
    };

    // Handle connection state changes
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;
      this.logger.info('Peer connection state:', state);

      switch (state) {
        case 'connected':
          this.stateManager.setConnectionState(ConnectionState.CONNECTED);
          this.startStatsCollection();
          break;
        case 'disconnected':
          this.stateManager.setConnectionState(ConnectionState.DISCONNECTED);
          break;
        case 'failed':
          this.stateManager.setConnectionState(ConnectionState.FAILED);
          this.cleanup();
          break;
        case 'closed':
          this.stateManager.setConnectionState(ConnectionState.DISCONNECTED);
          break;
      }
    };

    // Handle ICE connection state changes
    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection?.iceConnectionState;
      this.logger.info('ICE connection state:', state);
    };

    // Handle ICE gathering state changes
    this.peerConnection.onicegatheringstatechange = () => {
      const state = this.peerConnection?.iceGatheringState;
      this.logger.info('ICE gathering state:', state);
    };

    // Handle signaling state changes
    this.peerConnection.onsignalingstatechange = () => {
      const state = this.peerConnection?.signalingState;
      this.logger.debug('Signaling state:', state);
    };
  }

  /**
   * Create and send SDP offer
   */
  private async createAndSendOffer(): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    try {
      this.logger.info('Creating SDP offer');
      const offer = await this.peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });

      this.logger.debug('Setting local description');
      await this.peerConnection.setLocalDescription(offer);

      this.logger.info('Sending SDP offer to server');
      const message: StartMessage = {
        id: 'start',
        sdpOffer: offer.sdp!
      };
      this.signalingService.send(message);
    } catch (error) {
      this.logger.error('Failed to create offer:', error);
      throw error;
    }
  }

  /**
   * Process SDP answer from server
   */
  private async processAnswer(sdpAnswer: string): Promise<void> {
    if (!this.peerConnection) {
      this.logger.error('Peer connection not initialized');
      return;
    }

    try {
      this.logger.info('Processing SDP answer');
      const answer = new RTCSessionDescription({
        type: 'answer',
        sdp: sdpAnswer
      });

      await this.peerConnection.setRemoteDescription(answer);
      this.logger.info('Remote description set successfully');

      // Process queued ICE candidates
      await this.processIceCandidateQueue();
    } catch (error) {
      this.logger.error('Failed to process answer:', error);
      this.stateManager.setConnectionState(ConnectionState.FAILED);
      this.cleanup();
    }
  }

  /**
   * Add ICE candidate
   */
  private async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.peerConnection) {
      this.logger.warn('Peer connection not initialized, queuing ICE candidate');
      this.iceCandidateQueue.push(candidate);
      return;
    }

    if (!this.peerConnection.remoteDescription) {
      this.logger.debug('Remote description not set, queuing ICE candidate');
      this.iceCandidateQueue.push(candidate);
      return;
    }

    try {
      await this.peerConnection.addIceCandidate(candidate);
      this.logger.debug('Added ICE candidate');
    } catch (error) {
      this.logger.error('Failed to add ICE candidate:', error);
    }
  }

  /**
   * Process queued ICE candidates
   */
  private async processIceCandidateQueue(): Promise<void> {
    if (!this.peerConnection || !this.peerConnection.remoteDescription) {
      return;
    }

    this.logger.info(`Processing ${this.iceCandidateQueue.length} queued ICE candidates`);
    
    while (this.iceCandidateQueue.length > 0) {
      const candidate = this.iceCandidateQueue.shift();
      if (candidate) {
        try {
          await this.peerConnection.addIceCandidate(candidate);
        } catch (error) {
          this.logger.error('Failed to add queued ICE candidate:', error);
        }
      }
    }
  }

  /**
   * Setup signaling event handlers
   */
  private setupSignalingHandlers(): void {
    this.signalingService.setEventHandlers({
      onMessage: (message: IncomingMessage) => {
        this.handleSignalingMessage(message);
      },
      onClose: () => {
        this.logger.warn('Signaling connection closed');
        if (this.stateManager.isConnectionState(ConnectionState.CONNECTED)) {
          this.cleanup();
          this.stateManager.setConnectionState(ConnectionState.DISCONNECTED);
        }
      },
      onError: () => {
        this.logger.error('Signaling error occurred');
        this.stateManager.setConnectionState(ConnectionState.FAILED);
      }
    });
  }

  /**
   * Handle signaling messages
   */
  private handleSignalingMessage(message: IncomingMessage): void {
    this.logger.debug('Handling signaling message:', message.id);

    switch (message.id) {
      case 'startResponse':
        this.processAnswer((message as StartResponseMessage).sdpAnswer);
        break;
      case 'error':
        this.handleError((message as ErrorMessage).message);
        break;
      case 'iceCandidate':
        this.addIceCandidate((message as IncomingIceCandidateMessage).candidate);
        break;
      default:
        this.logger.warn('Unknown message type:', message.id);
    }
  }

  /**
   * Handle error messages
   */
  private handleError(errorMessage: string): void {
    this.logger.error('Server error:', errorMessage);
    this.stateManager.setConnectionState(ConnectionState.FAILED);
    this.cleanup();
  }

  /**
   * Setup state change handlers
   */
  private setupStateHandlers(): void {
    this.stateManager.onConnectionStateChange((event) => {
      this.logger.info(`Connection state changed: ${event.previousState} -> ${event.currentState}`);
    });

    this.stateManager.onMediaStateChange((event) => {
      this.logger.info(`Media state changed: ${event.previousState} -> ${event.currentState}`);
    });
  }

  /**
   * Start collecting connection statistics
   */
  private startStatsCollection(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }

    if (this.options.debug) {
      this.statsInterval = setInterval(async () => {
        const stats = await this.getConnectionStats();
        if (stats) {
          this.logConnectionStats(stats);
        }
      }, 5000);
    }
  }

  /**
   * Log connection statistics
   */
  private logConnectionStats(stats: RTCStatsReport): void {
    stats.forEach(report => {
      if (report.type === 'inbound-rtp' || report.type === 'outbound-rtp') {
        this.logger.debug(`${report.type} stats:`, {
          bytesReceived: report.bytesReceived,
          bytesSent: report.bytesSent,
          packetsLost: report.packetsLost,
          jitter: report.jitter
        });
      }
    });
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    this.logger.info('Cleaning up resources');

    // Stop stats collection
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    // Close peer connection
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    // Stop media streams
    this.mediaHandler.cleanup();

    // Clear ICE candidate queue
    this.iceCandidateQueue = [];
  }

  /**
   * Get default ICE configuration
   */
  private getDefaultIceConfiguration(): WebRTCConfig {
    return {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10
    };
  }

  /**
   * Create logger instance
   */
  private createLogger(): Logger {
    const prefix = '[WebRTCClient]';
    return {
      log: (message: string, ...args: any[]) => {
        console.log(`${prefix} ${message}`, ...args);
      },
      info: (message: string, ...args: any[]) => {
        console.info(`${prefix} ${message}`, ...args);
      },
      warn: (message: string, ...args: any[]) => {
        console.warn(`${prefix} ${message}`, ...args);
      },
      error: (message: string, ...args: any[]) => {
        console.error(`${prefix} ${message}`, ...args);
      },
      debug: (message: string, ...args: any[]) => {
        if (this.options.debug) {
          console.debug(`${prefix} ${message}`, ...args);
        }
      }
    };
  }
}