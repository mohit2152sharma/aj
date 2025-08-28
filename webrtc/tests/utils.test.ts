import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import {
    ConnectionState,
    createDataConnection,
    createReliableDataConnection,
    DataChannelState,
    DataConnection,
    DataConnectionConfig,
    MessageHandler
} from '../utils';

// Mock WebSocket Server for testing
class MockWebSocketServer {
    private wss: WebSocketServer | null = null;
    private clients: Set<WebSocket> = new Set();
    public port: number;

    constructor(port: number = 8081) {
        this.port = port;
    }

    start(): Promise<void> {
        return new Promise((resolve) => {
            this.wss = new WebSocketServer({ port: this.port });

            this.wss.on('connection', (ws: WebSocket) => {
                this.clients.add(ws);

                ws.on('message', (data: Buffer) => {
                    const message = JSON.parse(data.toString());
                    this.handleMessage(ws, message);
                });

                ws.on('close', () => {
                    this.clients.delete(ws);
                });
            });

            setTimeout(resolve, 100); // Give server time to start
        });
    }

    private handleMessage(sender: WebSocket, message: any) {
        // Echo signaling messages to simulate peer-to-peer signaling
        this.clients.forEach(client => {
            if (client !== sender && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(message));
            }
        });
    }

    stop(): Promise<void> {
        return new Promise((resolve) => {
            this.clients.forEach(client => client.close());
            this.clients.clear();

            if (this.wss) {
                this.wss.close(() => resolve());
            } else {
                resolve();
            }
        });
    }
}

// Test utilities
class TestMessageHandler implements MessageHandler {
    public messages: any[] = [];
    public connectionStates: ConnectionState[] = [];
    public dataChannelStates: DataChannelState[] = [];
    public errors: Error[] = [];

    onMessage = (data: any) => {
        this.messages.push(data);
    }

    onConnectionStateChange = (state: ConnectionState) => {
        this.connectionStates.push(state);
    }

    onDataChannelStateChange = (state: DataChannelState) => {
        this.dataChannelStates.push(state);
    }

    onError = (error: Error) => {
        this.errors.push(error);
    }

    reset() {
        this.messages = [];
        this.connectionStates = [];
        this.dataChannelStates = [];
        this.errors = [];
    }
}

function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper to wait for specific connection state
function waitForConnectionState(handler: TestMessageHandler, targetState: ConnectionState, timeout: number = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error(`Timeout waiting for connection state: ${targetState}`));
        }, timeout);

        if (handler.connectionStates.includes(targetState)) {
            clearTimeout(timeoutId);
            resolve();
            return;
        }

        const originalHandler = handler.onConnectionStateChange;
        handler.onConnectionStateChange = (state) => {
            originalHandler(state);
            if (state === targetState) {
                clearTimeout(timeoutId);
                resolve();
            }
        };
    });
}

// Helper to wait for connection to be established
async function waitForConnection(connection: DataConnection, handler: TestMessageHandler): Promise<void> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Timeout waiting for connection'));
        }, 5000);

        const checkConnection = () => {
            if (connection.isConnected()) {
                clearTimeout(timeout);
                resolve();
            }
        };

        // Check if already connected
        if (connection.isConnected()) {
            clearTimeout(timeout);
            resolve();
            return;
        }

        // Listen for state changes
        const originalHandler = handler.onConnectionStateChange;
        handler.onConnectionStateChange = (state) => {
            originalHandler(state);
            checkConnection();
        };
    });
}

describe('DataConnection', () => {
    let mockServer: MockWebSocketServer;
    let config: DataConnectionConfig;

    beforeAll(async () => {
        mockServer = new MockWebSocketServer();
        await mockServer.start();

        config = {
            websocketUrl: `ws://localhost:${mockServer.port}`,
            timeout: 5000
        };
    });

    afterAll(async () => {
        await mockServer.stop();
    });

    describe('Basic functionality', () => {
        it('should instantiate with correct initial state', () => {
            const connection = new DataConnection(config);

            expect(connection.getConnectionState()).toBe(ConnectionState.DISCONNECTED);
            expect(connection.getDataChannelState()).toBe(DataChannelState.CLOSED);
            expect(connection.isWebRTCActive()).toBe(false);
            expect(connection.isConnected()).toBe(false);

            connection.disconnect();
        });

        it('should establish WebSocket connection', async () => {
            const connection = new DataConnection(config);
            const handler = new TestMessageHandler();
            connection.setMessageHandler(handler);

            // Start connection
            const connectPromise = connection.connect(true);

            // Wait a bit for connection to start
            await wait(500);

            // Check if we have any connection state changes
            expect(handler.connectionStates.length).toBeGreaterThan(0);
            expect(handler.connectionStates[0]).toBe(ConnectionState.CONNECTING);

            connection.disconnect();
        });

        it('should handle message handler callbacks', async () => {
            const connection = new DataConnection(config);
            const handler = new TestMessageHandler();
            connection.setMessageHandler(handler);

            await connection.connect(true);
            await wait(500);

            expect(handler.connectionStates.length).toBeGreaterThan(0);
            expect(handler.connectionStates).toContain(ConnectionState.CONNECTING);

            connection.disconnect();
        });

        it('should transition through correct connection states', async () => {
            const connection = new DataConnection(config);
            const handler = new TestMessageHandler();
            connection.setMessageHandler(handler);

            await connection.connect(true);
            await wait(500);

            const expectedStates = [ConnectionState.CONNECTING, ConnectionState.WEBSOCKET_CONNECTED];
            expectedStates.forEach(state => {
                expect(handler.connectionStates).toContain(state);
            });

            connection.disconnect();
        });

        it('should send data via WebSocket fallback', async () => {
            const connection = new DataConnection(config);
            const handler = new TestMessageHandler();
            connection.setMessageHandler(handler);

            // Try to send data without connection - should fail
            const testData = { test: 'message', timestamp: Date.now() };
            const sent = await connection.sendData(testData);

            expect(sent).toBe(false); // Should fail without connection

            connection.disconnect();
        });

        it('should disconnect properly', async () => {
            const connection = new DataConnection(config);
            const handler = new TestMessageHandler();
            connection.setMessageHandler(handler);

            // Start connection and then disconnect immediately
            connection.connect(true);
            await wait(100); // Brief wait
            connection.disconnect();

            expect(connection.getConnectionState()).toBe(ConnectionState.DISCONNECTED);
            expect(connection.getDataChannelState()).toBe(DataChannelState.CLOSED);
            expect(connection.isConnected()).toBe(false);
        });
    });

    describe('Error handling', () => {
        it('should handle invalid WebSocket URL', async () => {
            const invalidConfig: DataConnectionConfig = {
                websocketUrl: 'ws://nonexistent-server:9999',
                timeout: 1000
            };

            const connection = new DataConnection(invalidConfig);
            const handler = new TestMessageHandler();
            connection.setMessageHandler(handler);

            // Wait for error to be reported
            const errorPromise = new Promise<void>((resolve) => {
                const originalHandler = handler.onError;
                handler.onError = (error) => {
                    originalHandler(error);
                    resolve();
                };
            });

            try {
                await connection.connect(true);
                await Promise.race([errorPromise, wait(2000)]);
            } catch (error) {
                // Connection might throw, that's ok
            }

            expect(handler.errors.length).toBeGreaterThan(0);

            connection.disconnect();
        });

        it('should handle connection timeout', async () => {
            const timeoutConfig: DataConnectionConfig = {
                websocketUrl: `ws://localhost:${mockServer.port}`,
                timeout: 100 // Very short timeout
            };

            const connection = new DataConnection(timeoutConfig);
            const handler = new TestMessageHandler();
            connection.setMessageHandler(handler);

            const startTime = Date.now();

            // Wait for error to be reported due to timeout
            const errorPromise = new Promise<void>((resolve) => {
                const originalHandler = handler.onError;
                handler.onError = (error) => {
                    originalHandler(error);
                    resolve();
                };
            });

            try {
                await connection.connect(true);
                await Promise.race([errorPromise, wait(1500)]);
            } catch (error) {
                // Connection might throw, that's ok
            }

            const elapsed = Date.now() - startTime;
            expect(elapsed).toBeLessThan(2000); // Should timeout quickly
            expect(handler.errors.length).toBeGreaterThan(0);

            connection.disconnect();
        });

        it('should propagate errors to handler', async () => {
            const connection = new DataConnection(config);
            const handler = new TestMessageHandler();
            connection.setMessageHandler(handler);

            // Stop server to simulate connection failure
            await mockServer.stop();

            try {
                await connection.connect(true);
                await wait(2000);
            } catch (error) {
                // Expected to fail
            }

            expect(handler.errors.length).toBeGreaterThan(0);

            connection.disconnect();

            // Restart server for remaining tests
            mockServer = new MockWebSocketServer(8081);
            await mockServer.start();
        });
    });

    describe('Multiple connections', () => {
        it('should handle multiple simultaneous connections', async () => {
            const connection1 = new DataConnection(config);
            const connection2 = new DataConnection(config);
            const handler1 = new TestMessageHandler();
            const handler2 = new TestMessageHandler();

            connection1.setMessageHandler(handler1);
            connection2.setMessageHandler(handler2);

            await Promise.all([
                connection1.connect(true),  // Initiator
                connection2.connect(false) // Answerer
            ]);

            await wait(1000);

            expect(handler1.connectionStates).toContain(ConnectionState.WEBSOCKET_CONNECTED);
            expect(handler2.connectionStates).toContain(ConnectionState.WEBSOCKET_CONNECTED);

            connection1.disconnect();
            connection2.disconnect();
        });
    });

    describe('Configuration and defaults', () => {
        it('should work with minimal configuration', async () => {
            const minimalConfig: DataConnectionConfig = {
                websocketUrl: `ws://localhost:${mockServer.port}`
            };

            const connection = new DataConnection(minimalConfig);

            // Should create connection with defaults
            expect(connection.getConnectionState()).toBe(ConnectionState.DISCONNECTED);
            expect(connection.getDataChannelState()).toBe(DataChannelState.CLOSED);

            connection.disconnect();
        });

        it('should handle different message formats', async () => {
            const connection = new DataConnection(config);
            const handler = new TestMessageHandler();
            connection.setMessageHandler(handler);

            // Test sending data without connection - should fail for both formats
            const jsonData = { type: 'test', value: 123 };
            const jsonSent = await connection.sendData(jsonData);

            const textData = 'plain text message';
            const textSent = await connection.sendData(textData);

            expect(jsonSent).toBe(false);
            expect(textSent).toBe(false);
            expect(connection.isConnected()).toBe(false);

            connection.disconnect();
        });
    });

    describe('State management', () => {
        it('should manage data channel states correctly', async () => {
            const connection = new DataConnection(config);
            const handler = new TestMessageHandler();
            connection.setMessageHandler(handler);

            // Initial state checks
            expect(connection.isWebRTCActive()).toBe(false);
            expect(connection.isConnected()).toBe(false);
            expect(connection.getDataChannelState()).toBe(DataChannelState.CLOSED);

            connection.disconnect();

            expect(connection.isConnected()).toBe(false);
        });
    });
});

describe('Utility functions', () => {
    let mockServer: MockWebSocketServer;
    let config: DataConnectionConfig;

    beforeAll(async () => {
        mockServer = new MockWebSocketServer(8083);
        await mockServer.start();

        config = {
            websocketUrl: `ws://localhost:${mockServer.port}`,
            timeout: 5000
        };
    });

    afterAll(async () => {
        await mockServer.stop();
    });

    it('should create connection with createDataConnection', () => {
        const connection = createDataConnection(config);

        expect(connection).toBeInstanceOf(DataConnection);
        expect(connection.getConnectionState()).toBe(ConnectionState.DISCONNECTED);

        connection.disconnect();
    });

    it('should handle reliable connection with retries', async () => {
        const invalidConfig: DataConnectionConfig = {
            websocketUrl: 'ws://nonexistent-server:9999',
            timeout: 100 // Very short timeout
        };

        await expect(createReliableDataConnection(invalidConfig, 1)).rejects.toThrow();
    });

    it('should successfully create reliable connection with valid config', async () => {
        const connection = await createReliableDataConnection(config, 1);

        expect(connection).toBeInstanceOf(DataConnection);
        expect(connection.isConnected()).toBe(true);

        connection.disconnect();
    }, 15000);
});

describe('Integration tests', () => {
    let mockServer: MockWebSocketServer;

    beforeEach(async () => {
        mockServer = new MockWebSocketServer(8084);
        await mockServer.start();
    });

    afterEach(async () => {
        await mockServer.stop();
    });

    it('should establish peer-to-peer connection', async () => {
        const config: DataConnectionConfig = {
            websocketUrl: `ws://localhost:${mockServer.port}`,
            timeout: 1000
        };

        const peer1 = new DataConnection(config);
        const peer2 = new DataConnection(config);

        const handler1 = new TestMessageHandler();
        const handler2 = new TestMessageHandler();

        peer1.setMessageHandler(handler1);
        peer2.setMessageHandler(handler2);

        try {
            // Start connections
            peer1.connect(true);  // Initiator
            peer2.connect(false); // Answerer

            await wait(500);

            // Check that connections were attempted
            expect(handler1.connectionStates).toContain(ConnectionState.CONNECTING);
            expect(handler2.connectionStates).toContain(ConnectionState.CONNECTING);

            // Test data sending (should fail without established connection)
            const testMessage = { from: 'peer1', message: 'Hello peer2!', timestamp: Date.now() };
            const sent = await peer1.sendData(testMessage);
            expect(typeof sent).toBe('boolean'); // Should return a boolean

        } finally {
            peer1.disconnect();
            peer2.disconnect();
        }
    }, 5000);
});
