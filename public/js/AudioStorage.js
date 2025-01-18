class AudioStorage {
    constructor() {
        this.storageKey = 'glm_audio_responses';
        this.orderKey = 'glm_audio_order';
        this.maxResponses = 10;
        this.initStorage();
    }

    initStorage() {
        if (!sessionStorage.getItem(this.storageKey)) {
            sessionStorage.setItem(this.storageKey, JSON.stringify({}));
            sessionStorage.setItem(this.orderKey, JSON.stringify([]));
        }
    }

    saveAudio(responseId, audioChunk) {
        try {
            const audioData = JSON.parse(sessionStorage.getItem(this.storageKey));
            const orderArray = JSON.parse(sessionStorage.getItem(this.orderKey));

            if (!audioData[responseId]) {
                audioData[responseId] = [];
                
                orderArray.push(responseId);
                
                while (orderArray.length > this.maxResponses) {
                    const oldestId = orderArray.shift();
                    delete audioData[oldestId];
                }
            }

            audioData[responseId].push(audioChunk);
            
            sessionStorage.setItem(this.storageKey, JSON.stringify(audioData));
            sessionStorage.setItem(this.orderKey, JSON.stringify(orderArray));
            return true;
        } catch (error) {
            console.error('保存音频数据失败:', error);
            return false;
        }
    }

    getAudio(responseId) {
        try {
            const audioData = JSON.parse(sessionStorage.getItem(this.storageKey));
            return audioData[responseId] || [];
        } catch (error) {
            console.error('获取音频数据失败:', error);
            return [];
        }
    }

    clearAudio(responseId) {
        try {
            const audioData = JSON.parse(sessionStorage.getItem(this.storageKey));
            const orderArray = JSON.parse(sessionStorage.getItem(this.orderKey));
            
            delete audioData[responseId];
            
            const index = orderArray.indexOf(responseId);
            if (index > -1) {
                orderArray.splice(index, 1);
            }
            
            sessionStorage.setItem(this.storageKey, JSON.stringify(audioData));
            sessionStorage.setItem(this.orderKey, JSON.stringify(orderArray));
            return true;
        } catch (error) {
            console.error('清除音频数据失败:', error);
            return false;
        }
    }

    clearAllAudio() {
        sessionStorage.removeItem(this.storageKey);
        sessionStorage.removeItem(this.orderKey);
        this.initStorage();
    }
}

export default AudioStorage;