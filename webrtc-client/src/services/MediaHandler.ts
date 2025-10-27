/**
 * Media handler service for managing video/audio streams
 */

import { MediaConstraints, MediaState, Logger } from '../types';
import { StateManager } from './StateManager';

export interface MediaEventHandlers {
  onLocalStream?: (stream: MediaStream) => void;
  onRemoteStream?: (stream: MediaStream) => void;
  onLocalStreamEnded?: () => void;
  onRemoteStreamEnded?: () => void;
  onMediaError?: (error: Error) => void;
}

export class MediaHandler {
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private localVideoElement: HTMLVideoElement | null = null;
  private remoteVideoElement: HTMLVideoElement | null = null;
  private mediaConstraints: MediaConstraints;
  private eventHandlers: MediaEventHandlers = {};
  private stateManager: StateManager;
  private logger: Logger;

  constructor(
    stateManager: StateManager,
    logger: Logger,
    mediaConstraints?: MediaConstraints
  ) {
    this.stateManager = stateManager;
    this.logger = logger;
    this.mediaConstraints = mediaConstraints || {
      video: {
        width: { min: 640, ideal: 1280, max: 1920 },
        height: { min: 480, ideal: 720, max: 1080 },
        frameRate: { ideal: 30, max: 60 }
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    };
  }

  /**
   * Set video elements for displaying streams
   */
  public setVideoElements(
    localElement?: HTMLVideoElement | string,
    remoteElement?: HTMLVideoElement | string
  ): void {
    if (localElement) {
      this.localVideoElement = typeof localElement === 'string'
        ? document.getElementById(localElement) as HTMLVideoElement
        : localElement;
    }

    if (remoteElement) {
      this.remoteVideoElement = typeof remoteElement === 'string'
        ? document.getElementById(remoteElement) as HTMLVideoElement
        : remoteElement;
    }
  }

  /**
   * Set event handlers
   */
  public setEventHandlers(handlers: MediaEventHandlers): void {
    this.eventHandlers = { ...this.eventHandlers, ...handlers };
  }

  /**
   * Start local media stream
   */
  public async startLocalStream(): Promise<MediaStream> {
    try {
      this.stateManager.setMediaState(MediaState.ACQUIRING);
      this.logger.info('Acquiring local media stream');

      // Check for media device support
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Media devices not supported in this browser');
      }

      // Request user media
      this.localStream = await navigator.mediaDevices.getUserMedia(this.mediaConstraints);
      
      // Attach to video element if available
      if (this.localVideoElement) {
        this.localVideoElement.srcObject = this.localStream;
        this.localVideoElement.muted = true; // Prevent echo
        await this.playVideo(this.localVideoElement);
      }

      // Setup track event handlers
      this.setupLocalStreamHandlers();

      this.stateManager.setMediaState(MediaState.ACTIVE);
      this.logger.info('Local media stream started');

      // Notify listeners
      if (this.eventHandlers.onLocalStream) {
        this.eventHandlers.onLocalStream(this.localStream);
      }

      return this.localStream;
    } catch (error) {
      this.stateManager.setMediaState(MediaState.ERROR);
      this.logger.error('Failed to start local stream:', error);
      
      if (this.eventHandlers.onMediaError) {
        this.eventHandlers.onMediaError(error as Error);
      }
      
      throw error;
    }
  }

  /**
   * Stop local media stream
   */
  public stopLocalStream(): void {
    if (this.localStream) {
      this.logger.info('Stopping local media stream');
      
      // Stop all tracks
      this.localStream.getTracks().forEach(track => {
        track.stop();
        this.logger.debug(`Stopped ${track.kind} track`);
      });

      // Clear video element
      if (this.localVideoElement) {
        this.localVideoElement.srcObject = null;
      }

      this.localStream = null;
      this.stateManager.setMediaState(MediaState.INACTIVE);

      // Notify listeners
      if (this.eventHandlers.onLocalStreamEnded) {
        this.eventHandlers.onLocalStreamEnded();
      }
    }
  }

  /**
   * Set remote stream
   */
  public setRemoteStream(stream: MediaStream): void {
    this.logger.info('Setting remote stream');
    this.remoteStream = stream;

    if (this.remoteVideoElement) {
      this.remoteVideoElement.srcObject = stream;
      this.playVideo(this.remoteVideoElement);
    }

    // Setup track event handlers
    this.setupRemoteStreamHandlers();

    // Notify listeners
    if (this.eventHandlers.onRemoteStream) {
      this.eventHandlers.onRemoteStream(stream);
    }
  }

  /**
   * Stop remote stream
   */
  public stopRemoteStream(): void {
    if (this.remoteStream) {
      this.logger.info('Stopping remote stream');

      // Clear video element
      if (this.remoteVideoElement) {
        this.remoteVideoElement.srcObject = null;
      }

      this.remoteStream = null;

      // Notify listeners
      if (this.eventHandlers.onRemoteStreamEnded) {
        this.eventHandlers.onRemoteStreamEnded();
      }
    }
  }

  /**
   * Get local stream
   */
  public getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  /**
   * Get remote stream
   */
  public getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  /**
   * Toggle audio mute
   */
  public toggleAudio(enabled?: boolean): boolean {
    if (!this.localStream) {
      this.logger.warn('No local stream to toggle audio');
      return false;
    }

    const audioTracks = this.localStream.getAudioTracks();
    audioTracks.forEach(track => {
      track.enabled = enabled !== undefined ? enabled : !track.enabled;
      this.logger.debug(`Audio track ${track.enabled ? 'enabled' : 'disabled'}`);
    });

    return audioTracks.length > 0 ? audioTracks[0].enabled : false;
  }

  /**
   * Toggle video
   */
  public toggleVideo(enabled?: boolean): boolean {
    if (!this.localStream) {
      this.logger.warn('No local stream to toggle video');
      return false;
    }

    const videoTracks = this.localStream.getVideoTracks();
    videoTracks.forEach(track => {
      track.enabled = enabled !== undefined ? enabled : !track.enabled;
      this.logger.debug(`Video track ${track.enabled ? 'enabled' : 'disabled'}`);
    });

    return videoTracks.length > 0 ? videoTracks[0].enabled : false;
  }

  /**
   * Get media statistics
   */
  public getMediaStats(): {
    hasLocalAudio: boolean;
    hasLocalVideo: boolean;
    hasRemoteAudio: boolean;
    hasRemoteVideo: boolean;
    localAudioEnabled: boolean;
    localVideoEnabled: boolean;
  } {
    const localAudioTracks = this.localStream?.getAudioTracks() || [];
    const localVideoTracks = this.localStream?.getVideoTracks() || [];
    const remoteAudioTracks = this.remoteStream?.getAudioTracks() || [];
    const remoteVideoTracks = this.remoteStream?.getVideoTracks() || [];

    return {
      hasLocalAudio: localAudioTracks.length > 0,
      hasLocalVideo: localVideoTracks.length > 0,
      hasRemoteAudio: remoteAudioTracks.length > 0,
      hasRemoteVideo: remoteVideoTracks.length > 0,
      localAudioEnabled: localAudioTracks.length > 0 ? localAudioTracks[0].enabled : false,
      localVideoEnabled: localVideoTracks.length > 0 ? localVideoTracks[0].enabled : false
    };
  }

  /**
   * Clean up all media resources
   */
  public cleanup(): void {
    this.stopLocalStream();
    this.stopRemoteStream();
    this.localVideoElement = null;
    this.remoteVideoElement = null;
    this.eventHandlers = {};
  }

  /**
   * Setup local stream event handlers
   */
  private setupLocalStreamHandlers(): void {
    if (!this.localStream) return;

    this.localStream.getTracks().forEach(track => {
      track.onended = () => {
        this.logger.warn(`Local ${track.kind} track ended`);
        if (this.eventHandlers.onLocalStreamEnded) {
          this.eventHandlers.onLocalStreamEnded();
        }
      };

      track.onmute = () => {
        this.logger.debug(`Local ${track.kind} track muted`);
      };

      track.onunmute = () => {
        this.logger.debug(`Local ${track.kind} track unmuted`);
      };
    });
  }

  /**
   * Setup remote stream event handlers
   */
  private setupRemoteStreamHandlers(): void {
    if (!this.remoteStream) return;

    this.remoteStream.getTracks().forEach(track => {
      track.onended = () => {
        this.logger.warn(`Remote ${track.kind} track ended`);
        if (this.eventHandlers.onRemoteStreamEnded) {
          this.eventHandlers.onRemoteStreamEnded();
        }
      };

      track.onmute = () => {
        this.logger.debug(`Remote ${track.kind} track muted`);
      };

      track.onunmute = () => {
        this.logger.debug(`Remote ${track.kind} track unmuted`);
      };
    });
  }

  /**
   * Play video element with autoplay policy handling
   */
  private async playVideo(videoElement: HTMLVideoElement): Promise<void> {
    try {
      await videoElement.play();
    } catch (error) {
      this.logger.warn('Autoplay failed, user interaction may be required:', error);
    }
  }
}