/**
 * State management service for WebRTC client
 */

import { ConnectionState, MediaState } from '../types';

export interface StateChangeEvent {
  previousState: ConnectionState | MediaState;
  currentState: ConnectionState | MediaState;
  timestamp: number;
}

export type StateChangeListener = (event: StateChangeEvent) => void;

export class StateManager {
  private connectionState: ConnectionState = ConnectionState.IDLE;
  private mediaState: MediaState = MediaState.IDLE;
  private connectionStateListeners: Set<StateChangeListener> = new Set();
  private mediaStateListeners: Set<StateChangeListener> = new Set();
  private stateHistory: StateChangeEvent[] = [];
  private maxHistorySize: number = 50;

  constructor(maxHistorySize: number = 50) {
    this.maxHistorySize = maxHistorySize;
  }

  /**
   * Get current connection state
   */
  public getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Get current media state
   */
  public getMediaState(): MediaState {
    return this.mediaState;
  }

  /**
   * Set connection state and notify listeners
   */
  public setConnectionState(newState: ConnectionState): void {
    if (this.connectionState === newState) {
      return;
    }

    const event: StateChangeEvent = {
      previousState: this.connectionState,
      currentState: newState,
      timestamp: Date.now()
    };

    this.connectionState = newState;
    this.addToHistory(event);
    this.notifyConnectionStateListeners(event);
  }

  /**
   * Set media state and notify listeners
   */
  public setMediaState(newState: MediaState): void {
    if (this.mediaState === newState) {
      return;
    }

    const event: StateChangeEvent = {
      previousState: this.mediaState,
      currentState: newState,
      timestamp: Date.now()
    };

    this.mediaState = newState;
    this.addToHistory(event);
    this.notifyMediaStateListeners(event);
  }

  /**
   * Subscribe to connection state changes
   */
  public onConnectionStateChange(listener: StateChangeListener): () => void {
    this.connectionStateListeners.add(listener);
    return () => this.connectionStateListeners.delete(listener);
  }

  /**
   * Subscribe to media state changes
   */
  public onMediaStateChange(listener: StateChangeListener): () => void {
    this.mediaStateListeners.add(listener);
    return () => this.mediaStateListeners.delete(listener);
  }

  /**
   * Check if connection is in a specific state
   */
  public isConnectionState(...states: ConnectionState[]): boolean {
    return states.includes(this.connectionState);
  }

  /**
   * Check if media is in a specific state
   */
  public isMediaState(...states: MediaState[]): boolean {
    return states.includes(this.mediaState);
  }

  /**
   * Check if client can start a new connection
   */
  public canStart(): boolean {
    return this.isConnectionState(
      ConnectionState.IDLE, 
      ConnectionState.DISCONNECTED, 
      ConnectionState.FAILED
    );
  }

  /**
   * Check if client can stop current connection
   */
  public canStop(): boolean {
    return this.isConnectionState(
      ConnectionState.CONNECTING,
      ConnectionState.CONNECTED
    );
  }

  /**
   * Get state history
   */
  public getHistory(): StateChangeEvent[] {
    return [...this.stateHistory];
  }

  /**
   * Clear state history
   */
  public clearHistory(): void {
    this.stateHistory = [];
  }

  /**
   * Reset all states to initial values
   */
  public reset(): void {
    this.setConnectionState(ConnectionState.IDLE);
    this.setMediaState(MediaState.IDLE);
    this.clearHistory();
  }

  /**
   * Add event to history with size limit
   */
  private addToHistory(event: StateChangeEvent): void {
    this.stateHistory.push(event);
    if (this.stateHistory.length > this.maxHistorySize) {
      this.stateHistory.shift();
    }
  }

  /**
   * Notify connection state listeners
   */
  private notifyConnectionStateListeners(event: StateChangeEvent): void {
    this.connectionStateListeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in connection state listener:', error);
      }
    });
  }

  /**
   * Notify media state listeners
   */
  private notifyMediaStateListeners(event: StateChangeEvent): void {
    this.mediaStateListeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in media state listener:', error);
      }
    });
  }
}