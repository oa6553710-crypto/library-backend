const net = require('net');
const http = require('http');
const WebSocket = require('ws');

const HTTP_PORT = process.env.PORT || 8081;
const TCP_PORT = process.env.MQTT_PORT ? Number(process.env.MQTT_PORT) : 1883;

const subscriptions = new Map();

function encodeRemainingLength(length) {
    const bytes = [];
    do {
        let digit = length % 128;
        length = Math.floor(length / 128);
        if (length > 0) digit |= 0x80;
        bytes.push(digit);
    } while (length > 0);
    return Buffer.from(bytes);
}

function parseRemainingLength(buffer, offset) {
    let multiplier = 1;
    let value = 0;
    let bytes = 0;
    let encodedByte;

    do {
        encodedByte = buffer[offset + bytes];
        value += (encodedByte & 0x7f) * multiplier;
        multiplier *= 128;
        bytes += 1;
    } while ((encodedByte & 0x80) !== 0 && bytes < 4);

    return { length: value, bytes };
}

function buildConnack() {
    return Buffer.from([0x20, 0x02, 0x00, 0x00]);
}

function buildPingresp() {
    return Buffer.from([0xD0, 0x00]);
}

function buildSuback(packetId) {
    return Buffer.concat([Buffer.from([0x90, 0x03]), packetId, Buffer.from([0x00])]);
}

function buildPublishPacket(topic, payload) {
    const topicBuffer = Buffer.from(topic, 'utf8');
    const payloadBuffer = Buffer.from(payload, 'utf8');
    const remainingLength = 2 + topicBuffer.length + payloadBuffer.length;
    return Buffer.concat([
        Buffer.from([0x30]),
        encodeRemainingLength(remainingLength),
        Buffer.from([topicBuffer.length >> 8, topicBuffer.length & 0xff]),
        topicBuffer,
        payloadBuffer
    ]);
}

function sendPacket(client, packet) {
    if (!client) return;
    if (typeof client.write === 'function') {
        client.write(packet);
    } else if (typeof client.send === 'function' && client.readyState === WebSocket.OPEN) {
        client.send(packet);
    }
}

function addSubscription(client, topic) {
    if (!subscriptions.has(client)) {
        subscriptions.set(client, []);
    }
    const topics = subscriptions.get(client);
    if (!topics.includes(topic)) {
        topics.push(topic);
    }
}

function publishToSubscribers(topic, payload) {
    const packet = buildPublishPacket(topic, payload);
    for (const [client, topics] of subscriptions.entries()) {
        if (topics.includes(topic)) {
            sendPacket(client, packet);
        }
    }
}

function handleSubscribe(client, buffer, offset, remainingLength) {
    const packetId = buffer.slice(offset, offset + 2);
    offset += 2;
    while (offset < 1 + remainingLength) {
        const topicLength = (buffer[offset] << 8) | buffer[offset + 1];
        offset += 2;
        const topic = buffer.slice(offset, offset + topicLength).toString('utf8');
        offset += topicLength;
        const qos = buffer[offset++];
        addSubscription(client, topic);
        console.log(`?? SUBSCRIBE ${topic} qos=${qos}`);
    }
    sendPacket(client, buildSuback(packetId));
}

function handlePublish(client, buffer, offset, remainingLength) {
    const topicLength = (buffer[offset] << 8) | buffer[offset + 1];
    offset += 2;
    const topic = buffer.slice(offset, offset + topicLength).toString('utf8');
    offset += topicLength;
    const payload = buffer.slice(offset, offset + remainingLength - 2 - topicLength).toString('utf8');
    console.log(`?? PUBLISH ${topic} -> ${payload}`);
    publishToSubscribers(topic, payload);
}

function handleMQTTPacket(client, buffer) {
    const packetType = buffer[0] >> 4;
    const { length: remainingLength, bytes: lengthBytes } = parseRemainingLength(buffer, 1);
    const offset = 1 + lengthBytes;

    switch (packetType) {
        case 1:
            console.log('?? CONNECT');
            sendPacket(client, buildConnack());
            break;
        case 3:
            handlePublish(client, buffer, offset, remainingLength);
            break;
        case 8:
            handleSubscribe(client, buffer, offset, remainingLength);
            break;
        case 12:
            console.log('?? PINGREQ');
            sendPacket(client, buildPingresp());
            break;
        default:
            console.log('?? Unsupported MQTT packet type:', packetType);
    }
}

function cleanupClient(client) {
    subscriptions.delete(client);
}

function handleTcpConnection(socket) {
    console.log('?? TCP client connected');
    subscriptions.set(socket, []);
    socket.on('data', (data) => handleMQTTPacket(socket, data));
    socket.on('close', () => {
        cleanupClient(socket);
        console.log('? TCP client disconnected');
    });
}

function handleWsConnection(ws) {
    console.log('?? WS client connected');
    subscriptions.set(ws, []);
    ws.on('message', (data) => {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        handleMQTTPacket(ws, buffer);
    });
    ws.on('close', () => {
        cleanupClient(ws);
        console.log('? WS client disconnected');
    });
}

const httpServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('MQTT Broker');
});

const wss = new WebSocket.Server({ server: httpServer });
wss.on('connection', handleWsConnection);

httpServer.listen(HTTP_PORT, () => {
    console.log(`?? HTTP/WebSocket server running on port ${HTTP_PORT}`);
});

const tcpServer = net.createServer(handleTcpConnection);
tcpServer.listen(TCP_PORT, '0.0.0.0', () => {
    console.log(`?? TCP MQTT broker running locally on port ${TCP_PORT}`);
});
