import AudioStorage from './js/AudioStorage.js';
import UIManager from './js/UIManager.js';

class GLMVoiceChat {
    constructor() {
        this.ws = null;
        this.mediaRecorder = null;
        this.audioContext = null;
        this.audioInput = null;
        this.recorder = null;
        this.isRecording = false;
        this.eventId = 0;
        this.analyser = null;
        this.visualizerCanvas = null;
        this.visualizerCtx = null;
        this.animationFrame = null;
        this.hasActiveResponse = false;
        this.currentMessageContainer = null;
        this.lastSpeaker = null;
        this.currentText = '';
        this.audioStorage = new AudioStorage();
        this.currentPlayingButton = null;
        this.shouldAutoPlay = false; 
        this.pendingAudioChunks = []; 

        this.apiKeyInput = document.getElementById('apiKeyInput');
        this.startButton = document.getElementById('startButton');
        this.stopButton = document.getElementById('stopButton');
        this.statusDiv = document.getElementById('status');
        this.transcriptionDiv = document.getElementById('transcription');
        this.debugInfo = document.getElementById('debugInfo');

        this.startButton.onclick = () => this.startChat();
        this.stopButton.onclick = () => this.stopChat();

        this.setupVisualizer();

        const savedApiKey = localStorage.getItem('glm_api_key');
        if (savedApiKey) {
            this.apiKeyInput.value = savedApiKey;
        }

        const uiManager = new UIManager();
    }

    debug(message) {
        const timestamp = new Date().toLocaleTimeString();
        const logMessage = `[${timestamp}] ${message}`;
        console.log(logMessage);
        
        if (this.debugInfo) {
            const messageElement = document.createElement('div');
            messageElement.textContent = logMessage;
            this.debugInfo.appendChild(messageElement);
            
            while (this.debugInfo.children.length > 10) {
                this.debugInfo.removeChild(this.debugInfo.firstChild);
            }
            
            this.debugInfo.scrollTop = this.debugInfo.scrollHeight;
        }
    }

    createMessageContainer(isUser = false) {
        const container = document.createElement('div');
        container.className = 'message-container';
        container.style.display = 'flex';
        container.style.flexDirection = 'column'; 
        container.style.marginBottom = '10px';
        
        if (isUser) {
            const userMessageText = document.createElement('div');
            userMessageText.className = 'message-text user-message';
            userMessageText.style.alignSelf = 'flex-end'; 
            userMessageText.style.backgroundColor = '#e3f2fd'; 
            userMessageText.style.padding = '8px';
            userMessageText.style.borderRadius = '8px';
            container.appendChild(userMessageText);
            return { container, messageText: userMessageText };
        } else {
            // GLM回复
            const messageText = document.createElement('div');
            messageText.className = 'message-text glm-message';
            messageText.style.alignSelf = 'flex-start'; 
            messageText.style.backgroundColor = '#f5f5f5';
            messageText.style.padding = '8px';
            messageText.style.borderRadius = '8px';
            
            const audioButton = document.createElement('button');
            audioButton.className = 'audio-button';
            audioButton.innerHTML = '🔈';
            audioButton.style.marginLeft = '10px';
            audioButton.style.padding = '5px 10px';
            audioButton.style.display = 'none';
            
            const messageRow = document.createElement('div');
            messageRow.style.display = 'flex';
            messageRow.style.alignItems = 'center';
            messageRow.appendChild(messageText);
            messageRow.appendChild(audioButton);
            
            container.appendChild(messageRow);
            
            return { container, messageText, audioButton };
        }
    }

    setupVisualizer() {
        const visualizer = document.getElementById('visualizer');
        this.visualizerCanvas = document.createElement('canvas');
        this.visualizerCanvas.width = visualizer.clientWidth;
        this.visualizerCanvas.height = visualizer.clientHeight;
        visualizer.appendChild(this.visualizerCanvas);
        this.visualizerCtx = this.visualizerCanvas.getContext('2d');
    }

    updateVisualizer() {
        if (!this.analyser || !this.isRecording) return;

        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        this.analyser.getByteFrequencyData(dataArray);

        this.visualizerCtx.fillStyle = '#f8f9fa';
        this.visualizerCtx.fillRect(0, 0, this.visualizerCanvas.width, this.visualizerCanvas.height);

        const barWidth = this.visualizerCanvas.width / bufferLength * 2.5;
        let barHeight;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            barHeight = (dataArray[i] / 255) * this.visualizerCanvas.height;
            const hue = (i / bufferLength) * 360;
            this.visualizerCtx.fillStyle = `hsl(${hue}, 70%, 60%)`;
            this.visualizerCtx.fillRect(x, this.visualizerCanvas.height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
        }

        this.animationFrame = requestAnimationFrame(() => this.updateVisualizer());
    }

    updateStatus(message) {
        this.debug(`状态更新: ${message}`);
        this.statusDiv.textContent = `状态: ${message}`;
    }

    appendTranscription(text, responseId) {
        if (!this.currentMessageContainer || this.lastResponseComplete) {
            const { container, messageText, audioButton } = this.createMessageContainer();
            this.currentMessageContainer = {
                container,
                messageText,
                audioButton,
                responseId
            };
            this.transcriptionDiv.appendChild(container);
            this.lastResponseComplete = false;
            this.currentText = '';
        }

        this.currentText += text;
        this.currentMessageContainer.messageText.textContent = this.currentText;

        const audioChunks = this.audioStorage.getAudio(responseId);
        if (audioChunks && audioChunks.length > 0) {
            this.currentMessageContainer.audioButton.style.display = 'block';
            this.currentMessageContainer.audioButton.onclick = () => this.playStoredAudio(responseId);
        }

        this.transcriptionDiv.scrollTop = this.transcriptionDiv.scrollHeight;
    }

    async playStoredAudio(responseId, button, isAutoPlay = false) {
        if (this.currentPlayingButton === button && this.isPlayingAudio && !isAutoPlay) {
            if (this.currentAudioPlayer) {
                this.currentAudioPlayer.stop();
                this.currentAudioPlayer = null;
            }
            button.innerHTML = '🔈';
            this.currentPlayingButton = null;
            this.isPlayingAudio = false;
            return;
        }

        if (this.isPlayingAudio) {
            if (this.currentAudioPlayer) {
                this.currentAudioPlayer.stop();
                this.currentAudioPlayer = null;
            }
            if (this.currentPlayingButton) {
                this.currentPlayingButton.innerHTML = '🔈';
            }
        }

        const audioChunks = this.audioStorage.getAudio(responseId);
        if (!audioChunks.length) {
            this.debug('未找到存储的音频数据');
            return;
        }

        button.innerHTML = '⏸️';
        this.currentPlayingButton = button;
        this.isPlayingAudio = true;

        try {
            for (const chunk of audioChunks) {
                if (!this.isPlayingAudio || this.currentPlayingButton !== button) {
                    break;
                }
                await this.playAudioChunk(chunk);
            }
        } catch (error) {
            this.debug(`播放音频失败: ${error.message}`);
        } finally {
            if (this.currentPlayingButton === button) {
                button.innerHTML = '🔈';
                this.currentPlayingButton = null;
                this.isPlayingAudio = false;
            }
        }
    }
    
    async resumeAudio() {
        if (!this.pausedAudioData) return;
        
        const { chunks, responseId } = this.pausedAudioData;
        this.pausedAudioData = null;
    
        try {
            for (const chunk of chunks) {
                if (!this.isPlayingAudio) {
                    break;
                }
                await this.playAudioChunk(chunk);
            }
        } finally {
            if (this.currentMessageContainer) {
                this.currentMessageContainer.audioButton.innerHTML = '🔈';
            }
            this.isPlayingAudio = false;
        }
    }

    async playAudioChunk(base64Audio) {
        return new Promise(async (resolve, reject) => {
            try {
                if (!this.isPlayingAudio) {
                    resolve();
                    return;
                }
    
                const audioData = atob(base64Audio);
                const arrayBuffer = new ArrayBuffer(audioData.length);
                const view = new Uint8Array(arrayBuffer);
                for (let i = 0; i < audioData.length; i++) {
                    view[i] = audioData.charCodeAt(i);
                }
                
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                const source = audioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(audioContext.destination);
                
                source.onended = () => {
                    if (this.currentAudioPlayer === source) {
                        this.currentAudioPlayer = null;
                    }
                    resolve();
                };
                
                source.start(0);
                this.currentAudioPlayer = source;

                if (!this.isPlayingAudio) {
                    source.stop();
                    this.currentAudioPlayer = null;
                    resolve();
                }
            } catch (error) {
                this.debug(`播放音频失败: ${error.message}`);
                reject(error);
            }
        });
    }

    getEventId() {
        this.eventId++;
        return `event_${this.eventId}`;
    }

    clearTranscription() {
        if (this.transcriptionDiv) {
            this.transcriptionDiv.innerHTML = '';
            this.currentMessageContainer = null;
            this.lastResponseComplete = true;
            this.shouldAutoPlay = false;
            this.pendingAudioChunks = [];
        }
    }

    async startChat() {
        const apiKey = this.apiKeyInput.value.trim();
        if (!apiKey) {
            alert('请输入API Key');
            return;
        }

        localStorage.setItem('glm_api_key', apiKey);
        this.clearTranscription();

        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.updateStatus('正在连接到服务器...');

            this.audioInput = this.audioContext.createMediaStreamSource(stream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            this.audioInput.connect(this.analyser);

            this.ws = new WebSocket('wss://glm-realtime.gujiakai.top');
            
            this.ws.onopen = () => {
                this.debug('WebSocket连接已建立');
                this.ws.send(JSON.stringify({
                    type: 'auth',
                    apiKey: apiKey
                }));
            };
            
            this.ws.onmessage = async (event) => this.handleWSMessage(event);
            this.ws.onerror = (error) => this.handleWSError(error);
            this.ws.onclose = () => this.handleWSClose();

            await this.setupRecorder(stream);

            this.startButton.disabled = true;
            this.stopButton.disabled = false;

            this.updateVisualizer();

        } catch (error) {
            this.updateStatus(`错误: ${error.message}`);
        }
    }

    async setupRecorder(stream) {
        return new Promise(async (resolve, reject) => {
            try {
                await this.audioContext.audioWorklet.addModule('js/AudioProcessor.js');
    
                const workletNode = new AudioWorkletNode(this.audioContext, 'audio-processor', {
                    numberOfInputs: 1,
                    numberOfOutputs: 1,
                    processorOptions: {
                        sampleRate: 16000,
                        bufferSize: 4096
                    }
                });
    
                const recorder = new Recorder(this.audioInput, {
                    numChannels: 1,
                    sampleRate: 16000
                });
    
                this.audioInput.connect(this.analyser);
                this.analyser.connect(workletNode);
    
                workletNode.port.onmessage = (event) => {
                    if (this.isRecording) {
                        recorder.record();
                    }
                };
    
                this.recorder = recorder;
                
                let sendTimeout = null;
                this.recordingInterval = setInterval(() => {
                    if (this.isRecording) {
                        if (sendTimeout) {
                            clearTimeout(sendTimeout);
                        }
                        sendTimeout = setTimeout(() => {
                            recorder.exportWAV((blob) => {
                                this.sendAudioData(blob);
                                recorder.clear();
                            });
                        }, 100);
                    }
                }, 1000);
    
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }

    async sendAudioData(blob) {
        if (this.ws && 
            this.ws.readyState === WebSocket.OPEN && 
            this.isRecording && 
            (!this.hasActiveResponse || this.hasValidSpeech)) {
            try {
                const buffer = await blob.arrayBuffer();
                const base64Audio = btoa(String.fromCharCode(...new Uint8Array(buffer)));
                
                const message = {
                    event_id: this.getEventId(),
                    type: 'input_audio_buffer.append',
                    audio: base64Audio,
                    client_timestamp: Date.now()
                };
                
                this.debug('发送音频数据');
                this.ws.send(JSON.stringify(message));
            } catch (error) {
                this.debug(`发送音频数据失败: ${error.message}`);
            }
        }
    }

    async playAudioResponse(base64Audio, responseId) {
        if (!responseId) {
            this.debug('没有 responseId，跳过音频处理');
            return;
        }

        this.audioStorage.saveAudio(responseId, base64Audio);
    
        if (this.hasActiveResponse && responseId === this.currentResponseId && !this.isPlayingAudio) {
            if (this.currentAudioPlayer) {
                this.currentAudioPlayer.stop();
                this.currentAudioPlayer = null;
            }
            if (this.currentPlayingButton) {
                this.currentPlayingButton.innerHTML = '🔈';
                this.currentPlayingButton = null;
            }
            
            this.shouldAutoPlay = true;
        }
    
        if (this.currentMessageContainer && 
            this.currentMessageContainer.responseId === responseId) {
            const audioButton = this.currentMessageContainer.audioButton;
            audioButton.style.display = 'block';
            audioButton.onclick = () => this.playStoredAudio(responseId, audioButton);
        }
    }

    stopChat() {
        this.isRecording = false;
        this.hasActiveResponse = false;
        this.hasValidSpeech = false;
        
        if (this.recordingInterval) {
            clearInterval(this.recordingInterval);
        }

        if (this.recorder) {
            this.recorder.stop();
        }

        if (this.ws) {
            this.ws.close();
        }

        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }

        this.audioStorage.clearAllAudio();

        this.startButton.disabled = false;
        this.stopButton.disabled = true;
        this.updateStatus('已断开连接');
    }

    async handleWSMessage(event) {
        try {
            let jsonData = typeof event.data === 'string' ? JSON.parse(event.data) : JSON.parse(await event.data.text());

            switch (jsonData.type) {
                case 'connected':
                    this.debug('认证成功，发送会话配置');
                    this.sendSessionConfig();
                    break;
                case 'session.created':
                    this.debug('会话已创建，开始录音');
                    break;
                case 'heartbeat':
                    this.debug('收到心跳包');
                    break;
                case 'session.updated':
                    this.debug('会话配置已更新，开始录音');
                    this.isRecording = true;
                    break;
                case 'input_audio_buffer.committed':
                    this.debug('音频数据已提交');
                    break;
                case 'input_audio_buffer.speech_started':
                    this.debug('检测到语音输入');
                    this.hasValidSpeech = true;
                    break;
                case 'input_audio_buffer.speech_stopped':
                    this.debug('语音输入结束');
                    this.hasValidSpeech = false;
                    break;
                case 'conversation.item.created':
                    this.debug('会话项已创建');
                    if (jsonData.item) {
                        const { id, role, content } = jsonData.item;
                        if (role === 'user' && content && content[0] && content[0].transcript) {
                            const { container, messageText } = this.createMessageContainer(true);
                            messageText.textContent = `用户: ${content[0].transcript}`;
                            this.transcriptionDiv.appendChild(container);
                        }
                    }
                    break;
                case 'conversation.item.input_audio_transcription.completed':
                    break;
                case 'response.created':
                    this.debug('开始生成响应');
                    
                    if (this.currentAudioPlayer) {
                        this.currentAudioPlayer.stop();
                        this.currentAudioPlayer = null;
                    }
                    if (this.currentPlayingButton) {
                        this.currentPlayingButton.innerHTML = '🔈';
                        this.currentPlayingButton = null;
                    }
                    this.isPlayingAudio = false;

                    this.shouldAutoPlay = false;
                    this.hasActiveResponse = true;
                    this.currentResponseId = jsonData.response.id;
                    
                    const { container, messageText, audioButton } = this.createMessageContainer(false);
                    this.currentMessageContainer = {
                        container,
                        messageText,
                        audioButton,
                        responseId: this.currentResponseId
                    };
                    
                    audioButton.style.display = 'block';
                    audioButton.onclick = () => this.playStoredAudio(this.currentResponseId, audioButton);
                    
                    messageText.textContent = 'GLM: ';
                    this.transcriptionDiv.appendChild(container);
                    this.currentText = '';
                    
                    this.shouldAutoPlay = true;
                    break;
                case 'response.audio_transcript.delta':
                    if (jsonData.delta && this.currentMessageContainer) {
                        this.debug('收到转录文本');
                        this.currentText += jsonData.delta;
                        this.currentMessageContainer.messageText.textContent = 'GLM: ' + this.currentText;
                        
                        this.currentMessageContainer.container.scrollIntoView({
                            behavior: 'smooth',
                            block: 'end'
                        });
                    }
                    break;
                case 'response.audio.delta':
                    if (jsonData.delta) {
                        this.debug('收到音频数据');
                        await this.playAudioResponse(jsonData.delta, this.currentResponseId);
                    }
                    break;
                case 'response.text.done':
                    this.debug('文本响应完成');
                    this.lastResponseComplete = true;
                    break;
                case 'response.done':
                    this.debug('响应完成');
                    this.hasActiveResponse = false;
                    this.lastResponseComplete = true;
                    
                    if (this.currentMessageContainer && this.currentMessageContainer.container) {
                        this.currentMessageContainer.container.style.marginBottom = '30px';
                    }
                
                    if (this.shouldAutoPlay && this.currentMessageContainer) {
                        this.shouldAutoPlay = false; 
     
                        if (this.currentAudioPlayer) {
                            this.currentAudioPlayer.stop();
                            this.currentAudioPlayer = null;
                        }
                        if (this.currentPlayingButton) {
                            this.currentPlayingButton.innerHTML = '🔈';
                        }
                
                        const audioChunks = this.audioStorage.getAudio(this.currentResponseId);
                        if (audioChunks && audioChunks.length > 0) {
                            await this.playStoredAudio(this.currentResponseId, this.currentMessageContainer.audioButton, true);
                        }
                    }
                    break;
                case 'error':
                    const errorMsg = jsonData.error?.message || '未知错误';
                    this.debug(`错误: ${errorMsg}`);
                    this.updateStatus(`错误: ${errorMsg}`);
                    break;
                case 'disconnected':
                    this.debug('连接已断开');
                    this.handleWSClose();
                    break;
                default:
                    this.debug(`收到未处理的消息类型: ${jsonData.type}`);
            }
        } catch (error) {
            this.debug(`处理消息出错: ${error.message}`);
        }
    }

    sendSessionConfig() {
        const sessionConfig = {
            event_id: this.getEventId(),
            type: 'session.update',
            session: {
                model: 'glm-4-realtime',
                input_audio_format: 'wav',
                output_audio_format: 'mp3',
                turn_detection: {
                    type: 'server_vad'
                },
                beta_fields: {
                    chat_mode: 'audio',
                    tts_source: 'e2e',
                    is_last_text: false
                }
            }
        };
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.debug('发送会话配置');
            this.ws.send(JSON.stringify(sessionConfig));
        } else {
            this.debug('WebSocket未连接，无法发送会话配置');
        }
    }

    handleWSError(error) {
        this.debug(`WebSocket错误: ${error.message}`);
        this.updateStatus(`连接错误: ${error.message}`);
    }

    handleWSClose() {
        this.debug('WebSocket连接已关闭');
        this.updateStatus('连接已关闭');
        this.startButton.disabled = false;
        this.stopButton.disabled = true;
        this.isRecording = false;
    }
}

window.onload = () => {
    new GLMVoiceChat();
};