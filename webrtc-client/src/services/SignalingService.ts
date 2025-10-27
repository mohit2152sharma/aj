/**
 * WebSocket signaling service for WebRTC communication
 */

import { 
  SignalingMessage, 
  IncomingMessage, 
  OutgoingMessage,
  Logger 
} from '../types';

export interface SignalingEventHandlers {
  onOpen?: (event: Event) => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (event: Event) => void;
  onMessage?: (message: IncomingMessage) => void;
}

export class SignalingService {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private messageQueue: OutgoingMessage[] = [];
  private eventHandlers: SignalingEventHandlers = {};
  private logger: Logger;
  private isIntentionallyClosed: boolean = false;

  constructor(wsUrl: string, logger: Logger) {
    this.wsUrl = wsUrl;
    this.logger = logger;
  }

  /**
   * Connect to WebSocket server
   */
  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.logger.warn('WebSocket is already connected');
        resolve();
        return;
      }

      this.isIntentionallyClosed = false;
      this.logger.info(`Connecting to WebSocket: ${this.wsUrl}`);

      try {
        this.ws = new WebSocket(this.wsUrl);
        this.setupEventHandlers();

        const connectTimeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
          this.disconnect();
        }, 10000);

        this.ws.onopen = (event) => {
          clearTimeout(connectTimeout);
          this.reconnectAttempts = 0;
          this.logger.info('WebSocket connected');
          this.flushMessageQueue();
          
          if (this.eventHandlers.onOpen) {
            this.eventHandlers.onOpen(event);
          }
          
          resolve();
        };

        this.ws.onerror = (event) => {
          clearTimeout(connectTimeout);
          this.logger.error('WebSocket error:', event);
          
          if (this.eventHandlers.onError) {
            this.eventHandlers.onError(event);
          }
          
          reject(new Error('WebSocket connection failed'));
        };
      } catch (error) {
        this.logger.error('Failed to create WebSocket:', error);
        reject(error);
      }
    });
  }

  /**
   * Disconnect from WebSocket server
   */
  public disconnect(): void {
    this.isIntentionallyClosed = true;
    this.clearReconnectTimer();
    
    if (this.ws) {
      this.logger.info('Disconnecting WebSocket');
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    
    this.messageQueue = [];
  }

  /**
   * Send message through WebSocket
   */
  public send(message: OutgoingMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.warn('WebSocket not connected, queuing message:', message);
      this.messageQueue.push(message);
      return;
    }

    try {
      const jsonMessage = JSON.stringify(message);
      this.logger.debug('Sending message:', jsonMessage);
      this.ws.send(jsonMessage);
    } catch (error) {
      this.logger.error('Failed to send message:', error);
      this.messageQueue.push(message);
    }
  }

  /**
   * Set event handlers
   */
  public setEventHandlers(handlers: SignalingEventHandlers): void {
    this.eventHandlers = { ...this.eventHandlers, ...handlers };
  }

  /**
   * Check if WebSocket is connected
   */
  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get WebSocket ready state
   */
  public getReadyState(): number {
    return this.ws ? this.ws.readyState : WebSocket.CLOSED;
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as IncomingMessage;
        this.logger.debug('Received message:', message);
        
        if (this.eventHandlers.onMessage) {
          this.eventHandlers.onMessage(message);
        }
      } catch (error) {
        this.logger.error('Failed to parse message:', error);
      }
    };

    this.ws.onclose = (event) => {
      this.logger.info(`WebSocket closed: ${event.code} - ${event.reason}`);
      
      if (this.eventHandlers.onClose) {
        this.eventHandlers.onClose(event);
      }
      
      if (!this.isIntentionallyClosed && !event.wasClean) {
        this.attemptReconnect();
      }
    };

    this.ws.onerror = (event) => {
      this.logger.error('WebSocket error:', event);
      
      if (this.eventHandlers.onError) {
        this.eventHandlers.onError(event);
      }
    };
  }

  /**
   * Attempt to reconnect to WebSocket server
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    this.logger.info(`Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
    
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((error) => {
        this.logger.error('Reconnection failed:', error);
      });
    }, delay);
  }

  /**
   * Clear reconnection timer
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Flush queued messages
   */
  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0 && this.isConnected()) {
      const message = this.messageQueue.shift();
      if (message) {
        this.send(message);
      }
    }
  }
}