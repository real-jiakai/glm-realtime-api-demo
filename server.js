// server.js
const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static('public'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = new Map();

wss.on('connection', (ws) => {
    console.log('新的客户端连接');
    let glmWs = null;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('收到客户端消息类型:', data.type);

            if (data.type === 'auth') {
                console.log('开始认证连接...');
                glmWs = new WebSocket('wss://open.bigmodel.cn/api/paas/v4/realtime', {
                    headers: {
                        'Authorization': `Bearer ${data.apiKey}`
                    }
                });

                glmWs.on('open', () => {
                    console.log('GLM连接成功');
                    ws.send(JSON.stringify({ type: 'connected' }));
                });

                glmWs.on('message', (glmMessage) => {
                    ws.send(glmMessage.toString());
                });

                glmWs.on('error', (error) => {
                    console.error('GLM连接错误:', error);
                });

                glmWs.on('close', () => {
                    console.log('GLM连接关闭');
                    ws.send(JSON.stringify({ type: 'disconnected' }));
                });

            } else if (glmWs && glmWs.readyState === WebSocket.OPEN) {
                if (data.type === 'input_audio_buffer.append') {
                    console.log('转发音频数据到GLM');
                    glmWs.send(JSON.stringify({
                        event_id: data.event_id,
                        type: 'input_audio_buffer.append',
                        audio: data.audio,
                        client_timestamp: Date.now()
                    }));
                } else {
                    console.log('转发其他消息到GLM:', data.type);
                    glmWs.send(JSON.stringify(data));
                }
            }
        } catch (error) {
            console.error('处理消息时出错:', error);
        }
    });

    ws.on('close', () => {
        console.log('客户端断开连接');
        if (glmWs) {
            glmWs.close();
        }
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3102;
server.listen(PORT, () => {
    console.log(`服务器运行在端口 ${PORT}`);
});

process.on('SIGTERM', () => {
    console.log('收到 SIGTERM 信号，关闭服务器...');
    server.close(() => {
        console.log('服务器已关闭');
        process.exit(0);
    });
});

app.use(express.static('public'));