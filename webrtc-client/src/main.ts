/**
 * Main entry point for WebRTC Client application
 */

import { WebRTCClient } from './components/WebRTCClient';
import { UIController } from './components/UIController';
import { ClientOptions, WebRTCConfig, MediaConstraints } from './types';

// Global variables
let webrtcClient: WebRTCClient | null = null;
let uiController: UIController | null = null;

/**
 * Get video quality constraints based on preset
 */
function getVideoConstraints(quality: string): MediaTrackConstraints {
    switch (quality) {
        case 'low':
            return {
                width: { ideal: 640 },
                height: { ideal: 480 },
                frameRate: { ideal: 15, max: 30 }
            };
        case 'medium':
            return {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30, max: 30 }
            };
        case 'high':
            return {
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30, max: 60 }
            };
        case 'ultra':
            return {
                width: { ideal: 3840 },
                height: { ideal: 2160 },
                frameRate: { ideal: 30, max: 60 }
            };
        default:
            return {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 }
            };
    }
}

/**
 * Get settings from UI
 */
function getSettingsFromUI(): {
    wsUrl: string;
    iceConfiguration: WebRTCConfig;
    mediaConstraints: MediaConstraints;
    debug: boolean;
} {
    const wsUrlInput = document.getElementById('wsUrl') as HTMLInputElement;
    const iceServersInput = document.getElementById('iceServers') as HTMLTextAreaElement;
    const videoQualitySelect = document.getElementById('videoQuality') as HTMLSelectElement;
    const echoCancellationCheck = document.getElementById('echoCancellation') as HTMLInputElement;
    const noiseSuppressionCheck = document.getElementById('noiseSuppression') as HTMLInputElement;
    const autoGainControlCheck = document.getElementById('autoGainControl') as HTMLInputElement;
    const debugModeCheck = document.getElementById('debugMode') as HTMLInputElement;

    let iceServers = [];
    try {
        iceServers = JSON.parse(iceServersInput.value);
    } catch (e) {
        console.error('Invalid ICE servers JSON, using defaults');
        iceServers = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ];
    }

    return {
        wsUrl: wsUrlInput.value || 'wss://localhost:8443/magicmirror',
        iceConfiguration: {
            iceServers: iceServers,
            iceCandidatePoolSize: 10
        },
        mediaConstraints: {
            video: getVideoConstraints(videoQualitySelect.value),
            audio: {
                echoCancellation: echoCancellationCheck.checked,
                noiseSuppression: noiseSuppressionCheck.checked,
                autoGainControl: autoGainControlCheck.checked
            }
        },
        debug: debugModeCheck.checked
    };
}

/**
 * Initialize WebRTC client
 */
function initializeClient(): void {
    const settings = getSettingsFromUI();
    
    // Create client options
    const options: ClientOptions = {
        wsUrl: settings.wsUrl,
        localVideoElement: 'localVideo',
        remoteVideoElement: 'remoteVideo',
        iceConfiguration: settings.iceConfiguration,
        mediaConstraints: settings.mediaConstraints,
        autoStart: false,
        debug: settings.debug
    };

    // Create WebRTC client
    webrtcClient = new WebRTCClient(options);

    // Create UI controller
    uiController = new UIController(webrtcClient, {
        showSpinner: true,
        showConsole: true,
        enableKeyboardShortcuts: true
    });

    // Initialize UI with elements
    uiController.initialize({
        startButton: document.getElementById('startBtn'),
        stopButton: document.getElementById('stopBtn'),
        connectButton: document.getElementById('connectBtn'),
        disconnectButton: document.getElementById('disconnectBtn'),
        muteAudioButton: document.getElementById('muteAudioBtn'),
        muteVideoButton: document.getElementById('muteVideoBtn'),
        statusIndicator: document.getElementById('statusIndicator'),
        localVideo: document.getElementById('localVideo') as HTMLVideoElement,
        remoteVideo: document.getElementById('remoteVideo') as HTMLVideoElement,
        consoleOutput: document.getElementById('consoleOutput')
    });

    // Log initialization
    uiController.log('WebRTC Client initialized', 'success');
}

/**
 * Setup event listeners
 */
function setupEventListeners(): void {
    // Apply settings button
    const applySettingsBtn = document.getElementById('applySettingsBtn');
    if (applySettingsBtn) {
        applySettingsBtn.addEventListener('click', () => {
            if (webrtcClient) {
                // Disconnect current client
                webrtcClient.disconnect();
                uiController?.log('Applying new settings...', 'info');
            }
            
            // Reinitialize with new settings
            initializeClient();
            
            // Close settings panel
            const offcanvas = bootstrap.Offcanvas.getInstance(document.getElementById('settingsPanel')!);
            if (offcanvas) {
                offcanvas.hide();
            }
        });
    }

    // Clear console button
    const clearConsoleBtn = document.getElementById('clearConsoleBtn');
    if (clearConsoleBtn) {
        clearConsoleBtn.addEventListener('click', () => {
            uiController?.clearConsole();
        });
    }

    // Fullscreen buttons
    document.querySelectorAll('.fullscreen-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = (e.currentTarget as HTMLElement).getAttribute('data-target');
            const video = document.getElementById(target!) as HTMLVideoElement;
            if (video) {
                if (!document.fullscreenElement) {
                    video.requestFullscreen().catch(err => {
                        console.error('Error attempting to enable fullscreen:', err);
                    });
                } else {
                    document.exitFullscreen();
                }
            }
        });
    });

    // Show keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === '?' && e.shiftKey) {
            const modal = new bootstrap.Modal(document.getElementById('shortcutsModal')!);
            modal.show();
        }
    });

    // Update statistics periodically
    setInterval(updateStatistics, 2000);
}

/**
 * Update connection statistics
 */
async function updateStatistics(): Promise<void> {
    if (!webrtcClient || !webrtcClient.isConnected()) {
        // Reset stats display
        document.getElementById('statBitrate')!.textContent = '0 kbps';
        document.getElementById('statPackets')!.textContent = '0';
        document.getElementById('statLatency')!.textContent = '0 ms';
        document.getElementById('statResolution')!.textContent = '-';
        return;
    }

    try {
        const stats = await webrtcClient.getConnectionStats();
        if (stats) {
            let bitrate = 0;
            let packets = 0;
            let latency = 0;
            let resolution = '-';

            stats.forEach(report => {
                if (report.type === 'inbound-rtp' && report.mediaType === 'video') {
                    // Calculate bitrate
                    if (report.bytesReceived) {
                        bitrate = Math.round((report.bytesReceived * 8) / 1000); // kbps
                    }
                    
                    // Get packets
                    if (report.packetsReceived) {
                        packets = report.packetsReceived;
                    }
                    
                    // Get resolution
                    if (report.frameWidth && report.frameHeight) {
                        resolution = `${report.frameWidth}x${report.frameHeight}`;
                    }
                }
                
                if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                    // Get RTT (latency)
                    if (report.currentRoundTripTime) {
                        latency = Math.round(report.currentRoundTripTime * 1000); // ms
                    }
                }
            });

            // Update UI
            document.getElementById('statBitrate')!.textContent = `${bitrate} kbps`;
            document.getElementById('statPackets')!.textContent = packets.toString();
            document.getElementById('statLatency')!.textContent = `${latency} ms`;
            document.getElementById('statResolution')!.textContent = resolution;
        }
    } catch (error) {
        console.error('Failed to get statistics:', error);
    }
}

/**
 * Check WebRTC support
 */
function checkWebRTCSupport(): boolean {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const message = 'Your browser does not support WebRTC. Please use a modern browser like Chrome, Firefox, or Edge.';
        alert(message);
        console.error(message);
        return false;
    }

    if (!RTCPeerConnection) {
        const message = 'RTCPeerConnection is not supported in your browser.';
        alert(message);
        console.error(message);
        return false;
    }

    return true;
}

/**
 * Initialize application when DOM is ready
 */
document.addEventListener('DOMContentLoaded', () => {
    console.log('WebRTC Client Application Starting...');

    // Check WebRTC support
    if (!checkWebRTCSupport()) {
        return;
    }

    // Initialize client
    initializeClient();

    // Setup event listeners
    setupEventListeners();

    // Handle page unload
    window.addEventListener('beforeunload', () => {
        if (webrtcClient) {
            webrtcClient.disconnect();
        }
    });

    console.log('WebRTC Client Application Ready');
});

// Declare bootstrap for TypeScript
declare const bootstrap: any;

// Export for debugging
(window as any).webrtcClient = () => webrtcClient;
(window as any).uiController = () => uiController;