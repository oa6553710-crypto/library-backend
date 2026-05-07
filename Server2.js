const net = require('net');

// Railway uses dynamic port assignment
const PORT = process.env.PORT || 1883;

const clients = new Map();
let systemActive = false;
// topic subscriptions storage
const subscriptions = new Map();

function sendConnack(socket) {
    socket.write(Buffer.from([0x20, 0x02, 0x00, 0x00]));
    console.log("✅ CONNACK sent");
}

// publish helper (زي aedes.publish)
function publish(topic, messageObj) {
    const payload = JSON.stringify(messageObj);
    const topicBytes = Buffer.from(topic, 'utf8');
    const payloadBytes = Buffer.from(payload, 'utf8');
    
    // MQTT PUBLISH packet structure:
    // Fixed header: 0x30 (PUBLISH, QoS 0)
    // Remaining length: topic length + payload length + 2 (topic length field)
    // Topic length (2 bytes)
    // Topic
    // Payload
    
    const topicLen = topicBytes.length;
    const remainingLen = 2 + topicLen + payloadBytes.length;
    
    // Calculate remaining length (variable length encoding)
    let remainingLenBytes = [];
    let len = remainingLen;
    do {
        let byte = len % 128;
        len = Math.floor(len / 128);
        if (len > 0) byte |= 0x80;
        remainingLenBytes.push(byte);
    } while (len > 0);
    
    // Build packet
    const packet = Buffer.concat([
        Buffer.from([0x30]), // PUBLISH header
        Buffer.from(remainingLenBytes), // Remaining length
        Buffer.from([topicLen >> 8, topicLen & 0xFF]), // Topic length (big endian)
        topicBytes, // Topic
        payloadBytes // Payload
    ]);

    // Send to all subscribed clients
    for (let [sock, subs] of subscriptions.entries()) {
        if (subs.includes(topic)) {
            sock.write(packet);
            console.log(`📤 Sent to ${topic}:`, payload);
        }
    }
}

const server = net.createServer((socket) => {

    console.log("🔥 CLIENT CONNECTED");

    clients.set(socket, []);
    subscriptions.set(socket, []);

    socket.on('data', (data) => {

        const packetType = data[0] >> 4;

        // CONNECT
        if (packetType === 1) {
            console.log("🔗 CONNECT");
            sendConnack(socket);
        }

        // SUBSCRIBE
        else if (packetType === 8) {
            console.log("📥 SUBSCRIBE received");
            
            // Parse MQTT SUBSCRIBE packet
            // Skip fixed header (1 byte) and remaining length
            let pos = 1;
            let multiplier = 1;
            let remainingLen = 0;
            let byte;
            
            do {
                byte = data[pos++];
                remainingLen += (byte & 0x7F) * multiplier;
                multiplier *= 128;
            } while ((byte & 0x80) !== 0);
            
            // Skip message ID (2 bytes)
            pos += 2;
            
            // Parse topic filters
            while (pos < data.length - 1) {
                // Topic length (2 bytes, big endian)
                const topicLen = (data[pos] << 8) | data[pos + 1];
                pos += 2;
                
                // Topic
                const topic = data.slice(pos, pos + topicLen).toString('utf8');
                pos += topicLen;
                
                // QoS (1 byte)
                const qos = data[pos++];
                
                // Add to subscriptions
                let subs = subscriptions.get(socket);
                if (!subs.includes(topic)) {
                    subs.push(topic);
                    console.log(`📋 Subscribed to: ${topic}`);
                }
                subscriptions.set(socket, subs);
            }
        }

        // PUBLISH
        else if (packetType === 3) {
            console.log("📤 PUBLISH received");
            
            // Parse MQTT PUBLISH packet
            let pos = 1;
            let multiplier = 1;
            let remainingLen = 0;
            let byte;
            
            do {
                byte = data[pos++];
                remainingLen += (byte & 0x7F) * multiplier;
                multiplier *= 128;
            } while ((byte & 0x80) !== 0);
            
            // Topic length (2 bytes, big endian)
            const topicLen = (data[pos] << 8) | data[pos + 1];
            pos += 2;
            
            // Topic
            const topic = data.slice(pos, pos + topicLen).toString('utf8');
            pos += topicLen;
            
            // Payload (remaining bytes)
            const payload = data.slice(pos);
            const payloadStr = payload.toString('utf8');
            
            console.log(`📦 Topic: ${topic}, Payload: ${payloadStr}`);
            
            // Handle status requests from ESP32
            if (topic === "library/request_status") {
                console.log("📋 Status request received - Sending current system state...");
                publish("library/status", {
                    isSystemActive: systemActive,
                    timestamp: new Date().toISOString()
                });
                return;
            }

            // Handle card scans from ESP32
            if (topic === "library/scan") {

                let tagId = "UNKNOWN";

                try {
                    const json = JSON.parse(payloadStr);
                    tagId = json.tagId;
                } catch (error) {
                    console.error("❌ Error parsing scan data:", error.message);
                    return;
                }

                console.log("🏷️ Card Scanned:", tagId);

                let response;

                // ===== ADMIN CARD =====
                if (tagId === "34FA78A3") {
                    systemActive = !systemActive;  // Toggle system state
                    response = {
                        status: systemActive ? "System ACTIVE" : "System LOCKED",
                        msg: systemActive ? "System Activated" : "System Locked"
                    };
                    console.log("🔐 Admin card - System now:", response.status);
                }

                // ===== BOOK CARDS =====
                else if (tagId === "AF69101C") {
                    response = {
                        status: "Book: Circuits",
                        msg: "Book borrowed: Circuits"
                    };
                    console.log("📚 Book scanned: Circuits");
                }
                else if (tagId === "7135704C") {
                    response = {
                        status: "Book: Math",
                        msg: "Book borrowed: Math"
                    };
                    console.log("📚 Book scanned: Math");
                }
                else if (tagId === "71D8714C") {
                    response = {
                        status: "Book: Network",
                        msg: "Book borrowed: Network"
                    };
                    console.log("📚 Book scanned: Network");
                }

                // ===== UNKNOWN CARD =====
                else {
                    response = {
                        status: "Unknown Card",
                        msg: "Card not recognized"
                    };
                    console.log("❓ Unknown card:", tagId);
                }

                // Send response back to ESP32 LCD
                publish("library/lcd", response);

                // Also publish to UI dashboard
                publish("library/ui", {
                    tagId,
                    ...response,
                    timestamp: new Date().toLocaleTimeString()
                });

                console.log("📡 Response sent");
            }
        }

    });

    socket.on('close', () => {
        clients.delete(socket);
        subscriptions.delete(socket);
    });

});

server.listen(PORT, "0.0.0.0", () => {
    console.log("🚀 CUSTOM MQTT BROKER RUNNING");
});