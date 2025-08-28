import WebSocket from 'ws';

export enum ConnectionState {
    DISCONNECTED = 'disconnected',
    CONNECTING = 'connecting',
    WEBSOCKET_CONNECTED = 'websocket_connected',
    WEBRTC_CONNECTING = 'webrtc_connecting',
    WEBRTC_CONNECTED = 'webrtc_connected',
    FAILED = 'failed'
}

export enum DataChannelState {
    CLOSED = 'closed',
    OPENING = 'opening',
    OPEN = 'open',
    FAILED = 'failed'
}

export interface DataConnectionConfig {
    websocketUrl: string;
    iceServers?: RTCIceServer[];
    dataChannelLabel?: string;
    fallbackToWebSocket?: boolean;
    timeout?: number;
}

export interface MessageHandler {
    onMessage: (data: any) => void;
    onConnectionStateChange: (state: ConnectionState) => void;
    onDataChannelStateChange: (state: DataChannelState) => void;
    onError: (error: Error) => void;
}

export class DataConnection {
    private websocket: WebSocket | null = null;
    private peerConnection: RTCPeerConnection | null = null;
    private dataChannel: RTCDataChannel | null = null;
    private config: Required<DataConnectionConfig>;
    private messageHandler: MessageHandler | null = null;
    private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
    private dataChannelState: DataChannelState = DataChannelState.CLOSED;
    private isInitiator: boolean = false;
    private connectionTimeout: NodeJS.Timeout | null = null;

    constructor(config: DataConnectionConfig) {
        this.config = {
            websocketUrl: config.websocketUrl,
            iceServers: config.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }],
            dataChannelLabel: config.dataChannelLabel || 'data',
            fallbackToWebSocket: config.fallbackToWebSocket ?? true,
            timeout: config.timeout || 10000
        };
    }

    public setMessageHandler(handler: MessageHandler): void {
        this.messageHandler = handler;
    }

    public async connect(isInitiator: boolean = true): Promise<void> {
        this.isInitiator = isInitiator;
        this.setState(ConnectionState.CONNECTING);

        try {
            await this.connectWebSocket();
            await this.setupWebRTC();

            if (this.isInitiator) {
                await this.createOffer();
            }

            this.startConnectionTimeout();
        } catch (error) {
            this.handleError(new Error(`Connection failed: ${error.message}`));
        }
    }

    public async sendData(data: any): Promise<boolean> {
        const message = typeof data === 'string' ? data : JSON.stringify(data);

        // Try WebRTC data channel first
        if (this.dataChannelState === DataChannelState.OPEN && this.dataChannel) {
            try {
                this.dataChannel.send(message);
                return true;
            } catch (error) {
                console.warn('Failed to send via data channel, falling back to WebSocket:', error);
            }
        }

        // Fallback to WebSocket
        if (this.config.fallbackToWebSocket &&
            this.websocket &&
            this.websocket.readyState === WebSocket.OPEN) {
            try {
                this.websocket.send(JSON.stringify({ type: 'data', payload: message }));
                return true;
            } catch (error) {
                this.handleError(new Error(`Failed to send data: ${error.message}`));
                return false;
            }
        }

        return false;
    }

    public disconnect(): void {
        this.clearConnectionTimeout();

        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }

        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }

        this.setState(ConnectionState.DISCONNECTED);
        this.setDataChannelState(DataChannelState.CLOSED);
    }

    public getConnectionState(): ConnectionState {
        return this.connectionState;
    }

    public getDataChannelState(): DataChannelState {
        return this.dataChannelState;
    }

    public isWebRTCActive(): boolean {
        return this.dataChannelState === DataChannelState.OPEN;
    }

    public isConnected(): boolean {
        return this.connectionState === ConnectionState.WEBRTC_CONNECTED ||
            this.connectionState === ConnectionState.WEBSOCKET_CONNECTED ||
            this.connectionState === ConnectionState.WEBRTC_CONNECTING;
    }

    private async connectWebSocket(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.websocket = new WebSocket(this.config.websocketUrl);

                this.websocket.onopen = () => {
                    this.setState(ConnectionState.WEBSOCKET_CONNECTED);
                    resolve();
                };

                this.websocket.onmessage = (event) => {
                    const data = typeof event.data === 'string' ? event.data : event.data.toString();
                    this.handleWebSocketMessage(data);
                };

                this.websocket.onerror = (error) => {
                    reject(new Error(`WebSocket connection failed: ${error}`));
                };

                this.websocket.onclose = () => {
                    if (this.connectionState === ConnectionState.CONNECTING) {
                        reject(new Error('WebSocket closed during connection'));
                    }
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    private async setupWebRTC(): Promise<void> {
        this.peerConnection = new RTCPeerConnection({
            iceServers: this.config.iceServers
        });

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate && this.websocket?.readyState === WebSocket.OPEN) {
                this.websocket.send(JSON.stringify({
                    type: 'ice-candidate',
                    candidate: event.candidate
                }));
            }
        };

        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection?.connectionState;
            if (state === 'connected') {
                this.setState(ConnectionState.WEBRTC_CONNECTED);
                this.clearConnectionTimeout();
            } else if (state === 'failed' || state === 'disconnected') {
                if (!this.config.fallbackToWebSocket) {
                    this.handleError(new Error('WebRTC connection failed'));
                }
            }
        };

        // Handle incoming data channels (for non-initiator)
        this.peerConnection.ondatachannel = (event) => {
            this.setupDataChannel(event.channel);
        };

        // Create data channel (for initiator)
        if (this.isInitiator) {
            const dataChannel = this.peerConnection.createDataChannel(this.config.dataChannelLabel, {
                ordered: true
            });
            this.setupDataChannel(dataChannel);
        }

        this.setState(ConnectionState.WEBRTC_CONNECTING);
    }

    private setupDataChannel(channel: RTCDataChannel): void {
        this.dataChannel = channel;
        this.setDataChannelState(DataChannelState.OPENING);

        channel.onopen = () => {
            this.setDataChannelState(DataChannelState.OPEN);
            this.setState(ConnectionState.WEBRTC_CONNECTED);
        };

        channel.onmessage = (event) => {
            this.handleDataChannelMessage(event.data);
        };

        channel.onclose = () => {
            this.setDataChannelState(DataChannelState.CLOSED);
        };

        channel.onerror = (error) => {
            this.setDataChannelState(DataChannelState.FAILED);
            console.warn('Data channel error:', error);
        };
    }

    private async createOffer(): Promise<void> {
        if (!this.peerConnection) throw new Error('Peer connection not initialized');

        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);

        if (this.websocket?.readyState === WebSocket.OPEN) {
            this.websocket.send(JSON.stringify({
                type: 'offer',
                offer: offer
            }));
        }
    }

    private async handleOffer(offer: RTCSessionDescriptionInit): Promise<void> {
        if (!this.peerConnection) return;

        await this.peerConnection.setRemoteDescription(offer);
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);

        if (this.websocket?.readyState === WebSocket.OPEN) {
            this.websocket.send(JSON.stringify({
                type: 'answer',
                answer: answer
            }));
        }
    }

    private async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
        if (!this.peerConnection) return;
        await this.peerConnection.setRemoteDescription(answer);
    }

    private async handleIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
        if (!this.peerConnection) return;

        try {
            await this.peerConnection.addIceCandidate(candidate);
        } catch (error) {
            console.warn('Failed to add ICE candidate:', error);
        }
    }

    private handleWebSocketMessage(data: string): void {
        try {
            const message = JSON.parse(data);

            switch (message.type) {
                case 'offer':
                    this.handleOffer(message.offer);
                    break;
                case 'answer':
                    this.handleAnswer(message.answer);
                    break;
                case 'ice-candidate':
                    this.handleIceCandidate(message.candidate);
                    break;
                case 'data':
                    // Handle data received via WebSocket fallback
                    this.messageHandler?.onMessage(message.payload);
                    break;
                default:
                    // Handle custom message types
                    this.messageHandler?.onMessage(message);
            }
        } catch (error) {
            this.handleError(new Error(`Failed to parse WebSocket message: ${error.message}`));
        }
    }

    private handleDataChannelMessage(data: string): void {
        try {
            const parsed = JSON.parse(data);
            this.messageHandler?.onMessage(parsed);
        } catch {
            // If not JSON, treat as plain text
            this.messageHandler?.onMessage(data);
        }
    }

    private setState(state: ConnectionState): void {
        if (this.connectionState !== state) {
            this.connectionState = state;
            this.messageHandler?.onConnectionStateChange(state);
        }
    }

    private setDataChannelState(state: DataChannelState): void {
        if (this.dataChannelState !== state) {
            this.dataChannelState = state;
            this.messageHandler?.onDataChannelStateChange(state);
        }
    }

    private handleError(error: Error): void {
        this.setState(ConnectionState.FAILED);
        this.messageHandler?.onError(error);
    }

    private startConnectionTimeout(): void {
        this.connectionTimeout = setTimeout(() => {
            if (this.connectionState === ConnectionState.CONNECTING ||
                this.connectionState === ConnectionState.WEBRTC_CONNECTING) {
                this.handleError(new Error('Connection timeout'));
            }
        }, this.config.timeout);
    }

    private clearConnectionTimeout(): void {
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }
    }
}

// Utility function for simple usage
export function createDataConnection(config: DataConnectionConfig): DataConnection {
    return new DataConnection(config);
}

// Helper function to create a connection with automatic retry
export async function createReliableDataConnection(
    config: DataConnectionConfig,
    maxRetries: number = 3
): Promise<DataConnection> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const connection = new DataConnection(config);

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    connection.disconnect();
                    reject(new Error(`Connection attempt ${attempt} timed out`));
                }, config.timeout || 10000);

                connection.setMessageHandler({
                    onMessage: () => { },
                    onConnectionStateChange: (state) => {
                        if (state === ConnectionState.WEBRTC_CONNECTED ||
                            state === ConnectionState.WEBSOCKET_CONNECTED) {
                            clearTimeout(timeout);
                            resolve(connection);
                        } else if (state === ConnectionState.FAILED) {
                            clearTimeout(timeout);
                            connection.disconnect();
                            reject(new Error(`Connection attempt ${attempt} failed`));
                        }
                    },
                    onDataChannelStateChange: () => { },
                    onError: (error) => {
                        clearTimeout(timeout);
                        connection.disconnect();
                        reject(error);
                    }
                });

                connection.connect(true).catch(reject);
            });
        } catch (error) {
            lastError = error as Error;
            if (attempt === maxRetries) break;

            // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
    }

    throw lastError || new Error('Failed to establish reliable connection');
}