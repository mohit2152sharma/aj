import { RTCPeerConnection, nonstandard } from "@roamhq/wrtc";
import dotenv from 'dotenv';
import fs from 'fs';
import OpenAI from "openai";
import path from 'path';
import { WebSocketServer } from "ws";
dotenv.config();

const wss = new WebSocketServer({ port: 8080 });
const { RTCAudioSink } = nonstandard;

// Initialize OpenAI client with your API key
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Function to create proper WAV file buffer from PCM samples
function createWavBuffer(samples: Float32Array, sampleRate: number): Buffer {
    const numChannels = 1; // Mono
    const bytesPerSample = 2; // 16-bit
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = samples.length * bytesPerSample;
    const fileSize = 36 + dataSize;

    const buffer = Buffer.alloc(44 + dataSize);
    let offset = 0;

    // WAV header
    buffer.write('RIFF', offset); offset += 4;
    buffer.writeUInt32LE(fileSize, offset); offset += 4;
    buffer.write('WAVE', offset); offset += 4;
    buffer.write('fmt ', offset); offset += 4;
    buffer.writeUInt32LE(16, offset); offset += 4; // PCM format chunk size
    buffer.writeUInt16LE(1, offset); offset += 2;  // PCM format
    buffer.writeUInt16LE(numChannels, offset); offset += 2;
    buffer.writeUInt32LE(sampleRate, offset); offset += 4;
    buffer.writeUInt32LE(byteRate, offset); offset += 4;
    buffer.writeUInt16LE(blockAlign, offset); offset += 2;
    buffer.writeUInt16LE(16, offset); offset += 2; // bits per sample
    buffer.write('data', offset); offset += 4;
    buffer.writeUInt32LE(dataSize, offset); offset += 4;

    // Normalize and convert Float32Array to 16-bit PCM
    // First find the peak to normalize audio levels
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
        peak = Math.max(peak, Math.abs(samples[i]));
    }

    // Normalize if audio is too quiet (but avoid over-amplification)
    const normalizeGain = peak > 0.05 ? 1 : Math.min(0.3 / (peak + 0.001), 3);

    for (let i = 0; i < samples.length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i] * normalizeGain)); // Normalize and clamp
        const pcmValue = Math.round(sample * 0x7FFF); // Convert to 16-bit signed integer
        buffer.writeInt16LE(pcmValue, offset);
        offset += 2;
    }

    return buffer;
}

wss.on("connection", (ws) => {
    console.log("Client connected via WebSocket (for signaling)");

    const pc = new RTCPeerConnection();
    let audioSink = null; // Track the audio sink for cleanup
    let audioBuffer = []; // Buffer to store all audio samples
    let sampleRate = 48000; // Default sample rate
    let isRecording = false;

    pc.ontrack = (event) => {
        const [track] = event.streams[0].getTracks();
        console.log("Server: received track kind =", track.kind);

        if (track.kind === "audio") {
            const sink = new RTCAudioSink(track);
            audioSink = sink; // Store reference for cleanup

            sink.ondata = async (data) => {
                if (isRecording) {
                    // Continuously buffer all audio samples
                    audioBuffer = audioBuffer.concat(Array.from(data.samples));
                    sampleRate = data.sampleRate;

                    // Log periodic updates
                    if (audioBuffer.length % (data.sampleRate * 2) === 0) { // Every ~2 seconds
                        const durationSeconds = audioBuffer.length / data.sampleRate;
                        console.log(`Recording: ${durationSeconds.toFixed(1)}s buffered`);
                    }
                }
            };

            track.onended = () => {
                console.log("Audio track ended");
                sink.stop();
            };
        }
    };

    // When client creates a DataChannel, we get it here
    pc.ondatachannel = (event) => {
        const channel = event.channel;
        console.log("Server: DataChannel created by client:", channel.label);

        channel.onopen = () => {
            console.log("Server: DataChannel open");
        };

        channel.onmessage = (event) => {
            console.log("Server received:", event.data);
            // Echo back to client
            channel.send(`Echo: ${event.data}`);
        };
    };

    pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
            ws.send(JSON.stringify({ type: "ice-candidate", candidate }));
        }
    };

    ws.on("message", async (msg) => {
        const data = JSON.parse(msg.toString());

        if (data.type === "offer") {
            await pc.setRemoteDescription(data.offer);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({ type: "answer", answer }));
        } else if (data.type === "ice-candidate") {
            try {
                await pc.addIceCandidate(data.candidate);
            } catch (err) {
                console.error("Error adding ICE candidate:", err);
            }
        } else if (data.type === "start-recording") {
            console.log("🎙️ Starting audio recording...");
            isRecording = true;
            audioBuffer = []; // Clear any previous buffer
            ws.send(JSON.stringify({ type: "recording-started" }));
        } else if (data.type === "stop-recording") {
            console.log("⏹️ Stopping audio recording...");
            isRecording = false;

            if (audioBuffer.length > 0) {
                try {
                    // Create Float32Array from buffer
                    const collectedSamples = new Float32Array(audioBuffer);
                    const durationSeconds = collectedSamples.length / sampleRate;

                    console.log(`Processing recorded audio: ${collectedSamples.length} samples (${durationSeconds.toFixed(2)}s)`);

                    // Create WAV buffer
                    const wavBuffer = createWavBuffer(collectedSamples, sampleRate);

                    // Save audio file to current directory
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const filename = `recording-${timestamp}.wav`;
                    const filepath = path.join(process.cwd(), filename);

                    fs.writeFileSync(filepath, wavBuffer);
                    console.log(`✅ Audio saved to: ${filepath}`);

                    // Send to OpenAI for transcription
                    const audioFile = new File([new Uint8Array(wavBuffer)], filename, {
                        type: 'audio/wav',
                    });

                    console.log("Sending to OpenAI for transcription...");
                    const transcription = await openai.audio.transcriptions.create({
                        file: audioFile,
                        model: "gpt-4o-transcribe",
                        language: "en",
                        response_format: "text",
                    });

                    if (transcription && transcription.trim()) {
                        console.log("✅ OpenAI Transcription:", transcription);
                        ws.send(JSON.stringify({
                            type: "transcription",
                            text: transcription,
                            filename: filename,
                            duration: durationSeconds.toFixed(2)
                        }));
                    } else {
                        console.log("⚠️  Empty transcription received");
                        ws.send(JSON.stringify({
                            type: "error",
                            message: "No transcription received from OpenAI"
                        }));
                    }
                } catch (error) {
                    console.error("❌ Error processing audio:", error.message);
                    ws.send(JSON.stringify({
                        type: "error",
                        message: `Error processing audio: ${error.message}`
                    }));
                }
            } else {
                console.log("⚠️  No audio data recorded");
                ws.send(JSON.stringify({
                    type: "error",
                    message: "No audio data was recorded"
                }));
            }

            // Clear buffer after processing
            audioBuffer = [];
        }
    });

    // Cleanup when WebSocket connection closes
    ws.on("close", () => {
        console.log("Client disconnected - cleaning up resources");
        if (audioSink) {
            audioSink.stop();
            audioSink = null;
        }
        pc.close();
    });

    ws.on("error", (error) => {
        console.error("WebSocket error:", error);
        if (audioSink) {
            audioSink.stop();
            audioSink = null;
        }
        pc.close();
    });
});

console.log("Signaling server running on ws://localhost:8080");
