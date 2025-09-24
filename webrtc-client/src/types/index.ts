/**
 * Type definitions for WebRTC client
 */

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface WebRTCConfig {
  iceServers: IceServerConfig[];
  iceCandidatePoolSize?: number;
}

export interface SignalingMessage {
  id: string;
  [key: string]: any;
}

export interface StartMessage extends SignalingMessage {
  id: 'start';
  sdpOffer: string;
}

export interface StopMessage extends SignalingMessage {
  id: 'stop';
}

export interface IceCandidateMessage extends SignalingMessage {
  id: 'onIceCandidate';
  candidate: RTCIceCandidate | RTCIceCandidateInit;
}

export interface StartResponseMessage extends SignalingMessage {
  id: 'startResponse';
  sdpAnswer: string;
}

export interface ErrorMessage extends SignalingMessage {
  id: 'error';
  message: string;
}

export interface IncomingIceCandidateMessage extends SignalingMessage {
  id: 'iceCandidate';
  candidate: RTCIceCandidateInit;
}

export type IncomingMessage = 
  | StartResponseMessage 
  | ErrorMessage 
  | IncomingIceCandidateMessage;

export type OutgoingMessage = 
  | StartMessage 
  | StopMessage 
  | IceCandidateMessage;

export enum ConnectionState {
  IDLE = 'idle',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  DISCONNECTING = 'disconnecting',
  DISCONNECTED = 'disconnected',
  FAILED = 'failed'
}

export enum MediaState {
  IDLE = 'idle',
  ACQUIRING = 'acquiring',
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ERROR = 'error'
}

export interface MediaConstraints {
  video: boolean | MediaTrackConstraints;
  audio: boolean | MediaTrackConstraints;
}

export interface ClientOptions {
  localVideoElement?: HTMLVideoElement | string;
  remoteVideoElement?: HTMLVideoElement | string;
  wsUrl: string;
  iceConfiguration?: WebRTCConfig;
  mediaConstraints?: MediaConstraints;
  autoStart?: boolean;
  debug?: boolean;
}

export interface Logger {
  log(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
}