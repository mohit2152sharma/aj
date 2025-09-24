/**
 * UI Controller for managing user interface interactions
 */

import { WebRTCClient } from './WebRTCClient';
import { ConnectionState } from '../types';

export interface UIElements {
  startButton?: HTMLElement | null;
  stopButton?: HTMLElement | null;
  connectButton?: HTMLElement | null;
  disconnectButton?: HTMLElement | null;
  muteAudioButton?: HTMLElement | null;
  muteVideoButton?: HTMLElement | null;
  statusIndicator?: HTMLElement | null;
  localVideo?: HTMLVideoElement | null;
  remoteVideo?: HTMLVideoElement | null;
  consoleOutput?: HTMLElement | null;
}

export interface UIControllerOptions {
  showSpinner?: boolean;
  showConsole?: boolean;
  spinnerImage?: string;
  posterImage?: string;
  enableKeyboardShortcuts?: boolean;
}

export class UIController {
  private client: WebRTCClient;
  private elements: UIElements = {};
  private options: UIControllerOptions;
  private consoleMessages: string[] = [];
  private maxConsoleMessages: number = 100;
  private audioMuted: boolean = false;
  private videoMuted: boolean = false;

  constructor(client: WebRTCClient, options?: UIControllerOptions) {
    this.client = client;
    this.options = {
      showSpinner: true,
      showConsole: true,
      spinnerImage: './img/spinner.gif',
      posterImage: './img/webrtc.png',
      enableKeyboardShortcuts: true,
      ...options
    };
  }

  /**
   * Initialize UI controller with DOM elements
   */
  public initialize(elements: UIElements): void {
    this.elements = elements;
    this.setupEventListeners();
    this.updateUIState();
    
    if (this.options.enableKeyboardShortcuts) {
      this.setupKeyboardShortcuts();
    }

    this.log('UI Controller initialized');
  }

  /**
   * Update UI based on connection state
   */
  public updateUIState(): void {
    const state = this.client.getConnectionState();
    
    switch (state) {
      case ConnectionState.IDLE:
        this.setButtonStates(true, false, false, false);
        this.updateStatusIndicator('Ready', 'idle');
        break;
      case ConnectionState.CONNECTING:
        this.setButtonStates(false, false, false, false);
        this.updateStatusIndicator('Connecting...', 'connecting');
        this.showSpinner(true);
        break;
      case ConnectionState.CONNECTED:
        this.setButtonStates(false, true, false, true);
        this.updateStatusIndicator('Connected', 'connected');
        this.showSpinner(false);
        break;
      case ConnectionState.DISCONNECTING:
        this.setButtonStates(false, false, false, false);
        this.updateStatusIndicator('Disconnecting...', 'disconnecting');
        break;
      case ConnectionState.DISCONNECTED:
        this.setButtonStates(true, false, false, false);
        this.updateStatusIndicator('Disconnected', 'disconnected');
        this.showSpinner(false);
        break;
      case ConnectionState.FAILED:
        this.setButtonStates(true, false, false, false);
        this.updateStatusIndicator('Connection Failed', 'failed');
        this.showSpinner(false);
        break;
    }
  }

  /**
   * Log message to console
   */
  public log(message: string, type: 'info' | 'warn' | 'error' | 'success' = 'info'): void {
    const timestamp = new Date().toLocaleTimeString();
    const formattedMessage = `[${timestamp}] ${message}`;
    
    // Add to console messages
    this.consoleMessages.push(formattedMessage);
    if (this.consoleMessages.length > this.maxConsoleMessages) {
      this.consoleMessages.shift();
    }

    // Update console output if available
    if (this.elements.consoleOutput && this.options.showConsole) {
      const messageElement = document.createElement('li');
      messageElement.className = `console-message console-${type}`;
      messageElement.textContent = formattedMessage;
      
      const consoleList = this.elements.consoleOutput.querySelector('ul') || 
                          this.elements.consoleOutput;
      consoleList.appendChild(messageElement);
      
      // Auto-scroll to bottom
      this.elements.consoleOutput.scrollTop = this.elements.consoleOutput.scrollHeight;
    }

    // Also log to browser console
    switch (type) {
      case 'error':
        console.error(formattedMessage);
        break;
      case 'warn':
        console.warn(formattedMessage);
        break;
      default:
        console.log(formattedMessage);
    }
  }

  /**
   * Clear console output
   */
  public clearConsole(): void {
    this.consoleMessages = [];
    if (this.elements.consoleOutput) {
      const consoleList = this.elements.consoleOutput.querySelector('ul') || 
                          this.elements.consoleOutput;
      consoleList.innerHTML = '';
    }
  }

  /**
   * Show/hide loading spinner
   */
  public showSpinner(show: boolean): void {
    if (!this.options.showSpinner) return;

    const videos = [this.elements.localVideo, this.elements.remoteVideo].filter(Boolean);
    
    videos.forEach(video => {
      if (video) {
        if (show) {
          video.style.background = `center transparent url("${this.options.spinnerImage}") no-repeat`;
          video.poster = '';
        } else {
          video.style.background = '';
          if (!video.srcObject) {
            video.poster = this.options.posterImage || '';
          }
        }
      }
    });
  }

  /**
   * Setup event listeners for UI elements
   */
  private setupEventListeners(): void {
    // Start button
    if (this.elements.startButton) {
      this.elements.startButton.addEventListener('click', async () => {
        try {
          this.log('Starting WebRTC connection...');
          await this.client.start();
          this.updateUIState();
          this.log('WebRTC connection started', 'success');
        } catch (error) {
          this.log(`Failed to start: ${error}`, 'error');
          this.updateUIState();
        }
      });
    }

    // Stop button
    if (this.elements.stopButton) {
      this.elements.stopButton.addEventListener('click', () => {
        this.log('Stopping WebRTC connection...');
        this.client.stop();
        this.updateUIState();
        this.log('WebRTC connection stopped', 'success');
      });
    }

    // Connect button
    if (this.elements.connectButton) {
      this.elements.connectButton.addEventListener('click', async () => {
        try {
          this.log('Connecting to signaling server...');
          await this.client.connect();
          this.updateUIState();
          this.log('Connected to signaling server', 'success');
        } catch (error) {
          this.log(`Failed to connect: ${error}`, 'error');
          this.updateUIState();
        }
      });
    }

    // Disconnect button
    if (this.elements.disconnectButton) {
      this.elements.disconnectButton.addEventListener('click', () => {
        this.log('Disconnecting from signaling server...');
        this.client.disconnect();
        this.updateUIState();
        this.log('Disconnected from signaling server', 'success');
      });
    }

    // Mute audio button
    if (this.elements.muteAudioButton) {
      this.elements.muteAudioButton.addEventListener('click', () => {
        this.audioMuted = !this.audioMuted;
        const enabled = this.client.toggleAudio(!this.audioMuted);
        this.updateMuteButton(this.elements.muteAudioButton!, enabled, 'audio');
        this.log(`Audio ${enabled ? 'unmuted' : 'muted'}`);
      });
    }

    // Mute video button
    if (this.elements.muteVideoButton) {
      this.elements.muteVideoButton.addEventListener('click', () => {
        this.videoMuted = !this.videoMuted;
        const enabled = this.client.toggleVideo(!this.videoMuted);
        this.updateMuteButton(this.elements.muteVideoButton!, enabled, 'video');
        this.log(`Video ${enabled ? 'enabled' : 'disabled'}`);
      });
    }

    // Video element click handlers for fullscreen
    if (this.elements.localVideo) {
      this.elements.localVideo.addEventListener('dblclick', () => {
        this.toggleFullscreen(this.elements.localVideo!);
      });
    }

    if (this.elements.remoteVideo) {
      this.elements.remoteVideo.addEventListener('dblclick', () => {
        this.toggleFullscreen(this.elements.remoteVideo!);
      });
    }
  }

  /**
   * Setup keyboard shortcuts
   */
  private setupKeyboardShortcuts(): void {
    document.addEventListener('keydown', (event) => {
      // Ignore if user is typing in an input field
      if (event.target instanceof HTMLInputElement || 
          event.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (event.key.toLowerCase()) {
        case 's':
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            if (this.client.getConnectionState() === ConnectionState.IDLE) {
              this.elements.startButton?.click();
            } else if (this.client.isConnected()) {
              this.elements.stopButton?.click();
            }
          }
          break;
        case 'm':
          if (!event.ctrlKey && !event.metaKey) {
            this.elements.muteAudioButton?.click();
          }
          break;
        case 'v':
          if (!event.ctrlKey && !event.metaKey) {
            this.elements.muteVideoButton?.click();
          }
          break;
        case 'f':
          if (!event.ctrlKey && !event.metaKey) {
            const activeVideo = this.elements.remoteVideo?.srcObject ? 
              this.elements.remoteVideo : this.elements.localVideo;
            if (activeVideo) {
              this.toggleFullscreen(activeVideo);
            }
          }
          break;
        case 'escape':
          if (document.fullscreenElement) {
            document.exitFullscreen();
          }
          break;
      }
    });
  }

  /**
   * Set button states
   */
  private setButtonStates(
    startEnabled: boolean,
    stopEnabled: boolean,
    connectEnabled: boolean,
    disconnectEnabled: boolean
  ): void {
    if (this.elements.startButton) {
      (this.elements.startButton as HTMLButtonElement).disabled = !startEnabled;
    }
    if (this.elements.stopButton) {
      (this.elements.stopButton as HTMLButtonElement).disabled = !stopEnabled;
    }
    if (this.elements.connectButton) {
      (this.elements.connectButton as HTMLButtonElement).disabled = !connectEnabled;
    }
    if (this.elements.disconnectButton) {
      (this.elements.disconnectButton as HTMLButtonElement).disabled = !disconnectEnabled;
    }
  }

  /**
   * Update status indicator
   */
  private updateStatusIndicator(text: string, status: string): void {
    if (this.elements.statusIndicator) {
      this.elements.statusIndicator.textContent = text;
      this.elements.statusIndicator.className = `status-indicator status-${status}`;
    }
  }

  /**
   * Update mute button appearance
   */
  private updateMuteButton(button: HTMLElement, enabled: boolean, type: 'audio' | 'video'): void {
    const icon = button.querySelector('.icon, .glyphicon, i');
    if (icon) {
      if (type === 'audio') {
        icon.className = enabled ? 'glyphicon glyphicon-volume-up' : 'glyphicon glyphicon-volume-off';
      } else {
        icon.className = enabled ? 'glyphicon glyphicon-eye-open' : 'glyphicon glyphicon-eye-close';
      }
    }
    
    button.classList.toggle('muted', !enabled);
    button.setAttribute('aria-pressed', (!enabled).toString());
  }

  /**
   * Toggle fullscreen for video element
   */
  private toggleFullscreen(element: HTMLVideoElement): void {
    if (!document.fullscreenElement) {
      element.requestFullscreen().catch(err => {
        this.log(`Error attempting to enable fullscreen: ${err}`, 'error');
      });
    } else {
      document.exitFullscreen();
    }
  }
}