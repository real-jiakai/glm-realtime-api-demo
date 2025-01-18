// public/js/UIManager.js
class UIManager {
    constructor(debug) {
        this.debug = debug;
        this.initializeElements();
    }

    initializeElements() {
        this.apiKeyInput = document.getElementById('apiKeyInput');
        this.startButton = document.getElementById('startButton');
        this.stopButton = document.getElementById('stopButton');
        this.statusDiv = document.getElementById('status');
        this.transcriptionDiv = document.getElementById('transcription');
        this.debugInfo = document.getElementById('debugInfo');
    }

    setButtonStates(isRecording) {
        this.startButton.disabled = isRecording;
        this.stopButton.disabled = !isRecording;
    }
}

export default UIManager;