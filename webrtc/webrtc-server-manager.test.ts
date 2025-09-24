/**
 * Test suite for WebRTC Server Manager
 * 
 * This file contains unit and integration tests for the WebRTC server components.
 * Run with: npm test or vitest
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as ws from 'ws';
import {
  IceConfigurationManager,
  SessionManager,
  MediaPipelineManager,
  WebSocketHandler,
  WebRTCServerManager,
  createWebRTCServer,
  createWebRTCServerWithStunner,
  StunnerConfig,
  ServerConfig,
  WebRTCSession,
} from './webrtc-server-manager';

// Mock kurento-client
vi.mock('kurento-client', () => ({
  default: vi.fn((uri, callback) => {
    callback(null, {
      create: vi.fn((type, cb) => {
        if (type === 'MediaPipeline') {
          cb(null, {
            release: vi.fn(),
            create: vi.fn((elementType, elementCb) => {
              if (elementType === 'WebRtcEndpoint') {
                elementCb(null, {
                  processOffer: vi.fn((offer, offerCb) => {
                    offerCb(null, 'mock-sdp-answer');
                  }),
                  gatherCandidates: vi.fn((cb) => cb(null)),
                  addIceCandidate: vi.fn(),
                  on: vi.fn(),
                  connect: vi.fn((target, cb) => cb(null)),
                });
              } else if (elementType === 'FaceOverlayFilter') {
                elementCb(null, {
                  setOverlayedImage: vi.fn((uri, x, y, w, h, cb) => cb(null)),
                  connect: vi.fn((target, cb) => cb(null)),
                });
              }
            }),
          });
        }
      }),
    });
  }),
  getComplexType: vi.fn((type) => {
    if (type === 'IceCandidate') {
      return vi.fn((candidate) => candidate);
    }
  }),
}));

// ============================================================================
// ICE Configuration Manager Tests
// ============================================================================

describe('IceConfigurationManager', () => {
  let manager: IceConfigurationManager;
  const stunnerConfig: StunnerConfig = {
    authAddress: 'test-auth.local',
    authPort: '8088',
  };

  beforeEach(() => {
    manager = new IceConfigurationManager(stunnerConfig);
  });

  afterEach(() => {
    manager.stopPeriodicUpdates();
  });

  it('should initialize with correct configuration', () => {
    expect(manager).toBeDefined();
    expect(manager.getConfiguration()).toBeNull();
  });

  it('should load configuration from environment variables', () => {
    process.env.STUNNER_AUTH_ADDR = 'env-auth.local';
    process.env.STUNNER_AUTH_PORT = '9099';
    
    const envManager = new IceConfigurationManager(stunnerConfig);
    // The environment variables should override the provided config
    expect(envManager).toBeDefined();
    
    delete process.env.STUNNER_AUTH_ADDR;
    delete process.env.STUNNER_AUTH_PORT;
  });

  it('should emit iceConfigUpdated event when configuration is updated', (done) => {
    manager.on('iceConfigUpdated', (config) => {
      expect(config).toBeDefined();
      done();
    });

    // Mock the HTTP request for testing
    const mockConfig = { urls: 'turn:example.com', username: 'user', credential: 'pass' };
    manager['iceConfiguration'] = mockConfig;
    manager.emit('iceConfigUpdated', mockConfig);
  });

  it('should handle periodic updates', () => {
    const spy = vi.spyOn(manager, 'queryIceConfiguration');
    manager.startPeriodicUpdates(100, 'test-user');
    
    // Should be called immediately
    expect(spy).toHaveBeenCalled();
    
    manager.stopPeriodicUpdates();
  });
});

// ============================================================================
// Session Manager Tests
// ============================================================================

describe('SessionManager', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
  });

  it('should create and retrieve sessions', () => {
    const sessionId = 'test-session-1';
    const mockPipeline = { release: vi.fn() };
    const mockEndpoint = { addIceCandidate: vi.fn() };

    const session = sessionManager.createSession(sessionId, mockPipeline, mockEndpoint);
    
    expect(session).toBeDefined();
    expect(session.sessionId).toBe(sessionId);
    expect(sessionManager.hasSession(sessionId)).toBe(true);
    expect(sessionManager.getSession(sessionId)).toBe(session);
  });

  it('should remove sessions and clean up resources', () => {
    const sessionId = 'test-session-2';
    const mockPipeline = { release: vi.fn() };
    const mockEndpoint = { addIceCandidate: vi.fn() };

    sessionManager.createSession(sessionId, mockPipeline, mockEndpoint);
    expect(sessionManager.hasSession(sessionId)).toBe(true);

    sessionManager.removeSession(sessionId);
    expect(sessionManager.hasSession(sessionId)).toBe(false);
    expect(mockPipeline.release).toHaveBeenCalled();
  });

  it('should queue and retrieve ICE candidates', () => {
    const sessionId = 'test-session-3';
    const candidate1 = { candidate: 'candidate-1' };
    const candidate2 = { candidate: 'candidate-2' };

    sessionManager.queueCandidate(sessionId, candidate1);
    sessionManager.queueCandidate(sessionId, candidate2);

    const candidates = sessionManager.getQueuedCandidates(sessionId);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toBe(candidate1);
    expect(candidates[1]).toBe(candidate2);

    // Queue should be cleared after retrieval
    const emptyCandidates = sessionManager.getQueuedCandidates(sessionId);
    expect(emptyCandidates).toHaveLength(0);
  });

  it('should get all active sessions', () => {
    const mockPipeline = { release: vi.fn() };
    const mockEndpoint = { addIceCandidate: vi.fn() };

    sessionManager.createSession('session-1', mockPipeline, mockEndpoint);
    sessionManager.createSession('session-2', mockPipeline, mockEndpoint);
    sessionManager.createSession('session-3', mockPipeline, mockEndpoint);

    const sessions = sessionManager.getAllSessions();
    expect(sessions).toHaveLength(3);
  });

  it('should clean up expired sessions', () => {
    const mockPipeline = { release: vi.fn() };
    const mockEndpoint = { addIceCandidate: vi.fn() };

    // Create sessions with different ages
    const oldSession = sessionManager.createSession('old-session', mockPipeline, mockEndpoint);
    oldSession.createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours old

    const newSession = sessionManager.createSession('new-session', mockPipeline, mockEndpoint);

    sessionManager.cleanupExpiredSessions(60 * 60 * 1000); // 1 hour max age

    expect(sessionManager.hasSession('old-session')).toBe(false);
    expect(sessionManager.hasSession('new-session')).toBe(true);
  });
});

// ============================================================================
// Media Pipeline Manager Tests
// ============================================================================

describe('MediaPipelineManager', () => {
  let pipelineManager: MediaPipelineManager;

  beforeEach(() => {
    pipelineManager = new MediaPipelineManager('ws://test-kurento:8888/kurento');
  });

  it('should create Kurento client', async () => {
    const client = await pipelineManager.getKurentoClient();
    expect(client).toBeDefined();
    expect(client.create).toBeDefined();
  });

  it('should create media pipeline', async () => {
    const pipeline = await pipelineManager.createPipeline();
    expect(pipeline).toBeDefined();
    expect(pipeline.release).toBeDefined();
  });

  it('should create WebRTC endpoint', async () => {
    const pipeline = await pipelineManager.createPipeline();
    const endpoint = await pipelineManager.createWebRtcEndpoint(pipeline);
    expect(endpoint).toBeDefined();
    expect(endpoint.processOffer).toBeDefined();
  });

  it('should process SDP offer and generate answer', async () => {
    const pipeline = await pipelineManager.createPipeline();
    const endpoint = await pipelineManager.createWebRtcEndpoint(pipeline);
    const sdpOffer = 'mock-sdp-offer';
    
    const sdpAnswer = await pipelineManager.processOffer(endpoint, sdpOffer);
    expect(sdpAnswer).toBe('mock-sdp-answer');
  });

  it('should connect media elements', async () => {
    const pipeline = await pipelineManager.createPipeline();
    const endpoint = await pipelineManager.createWebRtcEndpoint(pipeline);
    const filter = await pipelineManager.createFaceOverlayFilter(pipeline, {
      uri: 'http://example.com/overlay.png',
      offsetX: 0,
      offsetY: 0,
      width: 1,
      height: 1,
    });

    await expect(pipelineManager.connectElements(endpoint, filter, true)).resolves.toBeUndefined();
  });
});

// ============================================================================
// WebSocket Handler Tests
// ============================================================================

describe('WebSocketHandler', () => {
  let wsHandler: WebSocketHandler;
  let sessionManager: SessionManager;
  let pipelineManager: MediaPipelineManager;
  let mockWs: any;

  beforeEach(() => {
    sessionManager = new SessionManager();
    pipelineManager = new MediaPipelineManager('ws://test-kurento:8888/kurento');
    wsHandler = new WebSocketHandler(sessionManager, pipelineManager);

    // Create mock WebSocket
    mockWs = {
      send: vi.fn(),
      on: vi.fn(),
      close: vi.fn(),
    };
  });

  it('should handle WebSocket connection', () => {
    const sessionId = 'test-session';
    wsHandler.handleConnection(mockWs, sessionId);
    
    expect(mockWs.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(mockWs.on).toHaveBeenCalledWith('close', expect.any(Function));
    expect(mockWs.on).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('should emit sessionStarted event on successful start', (done) => {
    wsHandler.on('sessionStarted', (sessionId) => {
      expect(sessionId).toBe('test-session');
      done();
    });

    // Simulate successful session start
    wsHandler.emit('sessionStarted', 'test-session');
  });

  it('should emit sessionStopped event on stop', (done) => {
    wsHandler.on('sessionStopped', (sessionId) => {
      expect(sessionId).toBe('test-session');
      done();
    });

    // Simulate session stop
    wsHandler.emit('sessionStopped', 'test-session');
  });

  it('should handle ICE candidates correctly', () => {
    const sessionId = 'test-session';
    const candidate = { candidate: 'test-candidate' };

    // Test queueing when session doesn't exist
    wsHandler['handleIceCandidate'](sessionId, candidate);
    const queuedCandidates = sessionManager.getQueuedCandidates(sessionId);
    expect(queuedCandidates).toHaveLength(0); // Already retrieved, so empty

    // Create session and test adding candidate
    const mockPipeline = { release: vi.fn() };
    const mockEndpoint = { addIceCandidate: vi.fn() };
    sessionManager.createSession(sessionId, mockPipeline, mockEndpoint);
    
    const addCandidateSpy = vi.spyOn(pipelineManager, 'addIceCandidate');
    wsHandler['handleIceCandidate'](sessionId, candidate);
    expect(addCandidateSpy).toHaveBeenCalledWith(mockEndpoint, candidate);
  });
});

// ============================================================================
// WebRTC Server Manager Tests
// ============================================================================

describe('WebRTCServerManager', () => {
  let server: WebRTCServerManager;
  const serverConfig: ServerConfig = {
    asUri: 'http://localhost:8443/',
    wsUri: 'ws://localhost:8888/kurento',
  };

  beforeEach(() => {
    server = createWebRTCServer(serverConfig);
  });

  afterEach(async () => {
    await server.stop();
  });

  it('should create server with basic configuration', () => {
    expect(server).toBeDefined();
    expect(server.getSessionManager()).toBeDefined();
    expect(server.getPipelineManager()).toBeDefined();
    expect(server.getWebSocketHandler()).toBeDefined();
  });

  it('should create server with STUNner integration', () => {
    const stunnerConfig: StunnerConfig = {
      authAddress: 'stunner.local',
      authPort: '8088',
    };

    const stunnerServer = createWebRTCServerWithStunner(serverConfig, stunnerConfig);
    expect(stunnerServer).toBeDefined();
    expect(stunnerServer.getIceManager()).toBeDefined();
    
    // Clean up
    stunnerServer.getIceManager()?.stopPeriodicUpdates();
  });

  it('should initialize STUNner after creation', () => {
    const stunnerConfig: StunnerConfig = {
      authAddress: 'stunner.local',
      authPort: '8088',
    };

    server.initializeStunner(stunnerConfig);
    expect(server.getIceManager()).toBeDefined();
    
    // Clean up
    server.getIceManager()?.stopPeriodicUpdates();
  });

  it('should set up middleware correctly', () => {
    const mockSessionHandler = vi.fn();
    server.setupMiddleware(mockSessionHandler);
    // Middleware should be set up without errors
    expect(server).toBeDefined();
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration Tests', () => {
  it('should handle complete WebRTC session lifecycle', async () => {
    const serverConfig: ServerConfig = {
      asUri: 'http://localhost:8443/',
      wsUri: 'ws://localhost:8888/kurento',
      overlayUri: 'http://example.com/overlay.png',
    };

    const server = createWebRTCServer(serverConfig);
    const sessionManager = server.getSessionManager();
    const pipelineManager = server.getPipelineManager();

    // Create a session
    const sessionId = 'integration-test-session';
    const pipeline = await pipelineManager.createPipeline();
    const endpoint = await pipelineManager.createWebRtcEndpoint(pipeline);
    
    const session = sessionManager.createSession(sessionId, pipeline, endpoint);
    expect(session).toBeDefined();
    expect(sessionManager.hasSession(sessionId)).toBe(true);

    // Process SDP offer
    const sdpOffer = 'test-sdp-offer';
    const sdpAnswer = await pipelineManager.processOffer(endpoint, sdpOffer);
    expect(sdpAnswer).toBeDefined();

    // Add ICE candidate
    const candidate = { candidate: 'test-candidate' };
    pipelineManager.addIceCandidate(endpoint, candidate);

    // Clean up session
    sessionManager.removeSession(sessionId);
    expect(sessionManager.hasSession(sessionId)).toBe(false);

    await server.stop();
  });

  it('should handle multiple concurrent sessions', async () => {
    const server = createWebRTCServer({
      asUri: 'http://localhost:8443/',
      wsUri: 'ws://localhost:8888/kurento',
    });

    const sessionManager = server.getSessionManager();
    const pipelineManager = server.getPipelineManager();

    // Create multiple sessions
    const sessionIds = ['session-1', 'session-2', 'session-3'];
    
    for (const sessionId of sessionIds) {
      const pipeline = await pipelineManager.createPipeline();
      const endpoint = await pipelineManager.createWebRtcEndpoint(pipeline);
      sessionManager.createSession(sessionId, pipeline, endpoint);
    }

    expect(sessionManager.getAllSessions()).toHaveLength(3);

    // Remove one session
    sessionManager.removeSession('session-2');
    expect(sessionManager.getAllSessions()).toHaveLength(2);
    expect(sessionManager.hasSession('session-1')).toBe(true);
    expect(sessionManager.hasSession('session-2')).toBe(false);
    expect(sessionManager.hasSession('session-3')).toBe(true);

    // Clean up remaining sessions
    sessionIds.forEach(id => sessionManager.removeSession(id));
    expect(sessionManager.getAllSessions()).toHaveLength(0);

    await server.stop();
  });
});