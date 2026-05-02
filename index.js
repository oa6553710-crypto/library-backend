const aedes = require('aedes')();
const server = require('net').createServer(aedes.handle);
const httpServer = require('http').createServer();
const ws = require('websocket-stream');
const { google } = require('googleapis');

// --- Configuration & Constants ---
const ADMIN_CARD = "34FA78A3"; 
const BOOKS = {
    "AF69101C": "Circuits", 
    "7135704C": "Math",
    "71D8714C": "Network"
};

const MY_SHEET_ID = process.env.SHEET_ID;

// --- Google Sheets Functions ---
async function getStatusFromSheet(targetTagId = null) {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: MY_SHEET_ID,
            range: 'Sheet1!A:C', 
        });
        const rows = response.data.values || [];
        
        let systemActive = false;
        const adminRows = rows.filter(r => r[0] === ADMIN_CARD);
        if (adminRows.length > 0) {
            const lastStatus = adminRows[adminRows.length - 1][2] || "";
            systemActive = lastStatus.trim().toUpperCase() === "SYSTEM ACTIVE";
        }

        let lastBookStatus = "Returned"; 
        if (targetTagId) {
            const bookRows = rows.filter(r => r[0] === targetTagId);
            if (bookRows.length > 0) {
                lastBookStatus = bookRows[bookRows.length - 1][2];
            }
        }
        return { systemActive, lastBookStatus };
    } catch (e) {
        console.error("Sync Error:", e.message);
        return { systemActive: false, lastBookStatus: "Returned" };
    }
}

async function logToSheet(tagId, bookName, status) {
    try {
        const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
        if (credentials.private_key) {
            credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
        }
        
        const auth = new google.auth.GoogleAuth({ 
            credentials, 
            scopes: ['https://www.googleapis.com/auth/spreadsheets'] 
        });
        const sheets = google.sheets({ version: 'v4', auth });
        
        const now = new Date();
        const dateStr = now.toLocaleDateString("en-GB", { timeZone: "Africa/Cairo" });
        const timeStr = now.toLocaleTimeString("en-GB", { timeZone: "Africa/Cairo" });

        await sheets.spreadsheets.values.append({
            spreadsheetId: MY_SHEET_ID,
            range: 'Sheet1!A:E',
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[tagId, bookName, status, dateStr, timeStr]] },
        });
    } catch (e) { 
        console.error('Logging Error:', e.message); 
    }
}

// --- MQTT Logic Bridge ---
aedes.on('publish', async (packet, client) => {
    if (packet.topic === 'library/scan' && client) {
        try {
            const data = JSON.parse(packet.payload.toString());
            const tagId = data.tagId;
            
            const { systemActive, lastBookStatus } = await getStatusFromSheet(tagId);
            let statusResponse = "";
            let newSystemState = systemActive;

            if (tagId === ADMIN_CARD) {
                newSystemState = !systemActive;
                statusResponse = newSystemState ? "System ACTIVE" : "System LOCKED";
                await logToSheet(tagId, "Admin Control", statusResponse);

                // --- التعديل الجوهري: إرسال حالة القفل للموقع مباشرة ---
                aedes.publish({
                    topic: 'library/status',
                    payload: JSON.stringify({ isSystemActive: newSystemState }),
                    qos: 0, retain: true
                });

            } else if (!systemActive) {
                statusResponse = "Access Denied";
            } else if (BOOKS[tagId]) {
                const bookName = BOOKS[tagId];
                const newState = (lastBookStatus === "Borrowed") ? "Returned" : "Borrowed";
                await logToSheet(tagId, bookName, newState);
                statusResponse = `${bookName} ${newState === "Borrowed" ? "Borrowed" : "Returned"}`;
            } else {
                statusResponse = "Unknown Card";
            }

            // إرسال النتيجة للـ ESP32
            aedes.publish({
                topic: 'library/lcd',
                payload: JSON.stringify({ status: statusResponse }),
                qos: 0, retain: false
            });

            // إرسال تحديث فوري للموقع
            aedes.publish({
                topic: 'library/ui',
                payload: JSON.stringify({ 
                    tagId, 
                    status: statusResponse, 
                    isSystemActive: newSystemState, // إضافة الحالة هنا برضه للاحتياط
                    time: new Date().toLocaleTimeString("en-GB", { timeZone: "Africa/Cairo" }) 
                }),
                qos: 0, retain: false
            });
        } catch (err) {
            console.error("Processing Error:", err.message);
        }
    }
});
// ضيف الجزء ده في آخر ملف index.js عشان الموقع يعرف يقرأ الـ Google Sheet
httpServer.on('request', async (req, res) => {
    // تفعيل الـ CORS عشان المتصفح ميرفضش الطلب
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.url === '/logs') {
        try {
            const auth = new google.auth.GoogleAuth({
                credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
                scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
            });
            const sheets = google.sheets({ version: 'v4', auth });
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: MY_SHEET_ID,
                range: 'Sheet1!A:E', // هيسحب الخمس أعمدة
            });
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(response.data.values || []));
        } catch (err) {
            console.error("API Error:", err.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
        }
    } else {
        res.writeHead(404);
        res.end();
    }
});

// --- Server Ports ---
const PORT = process.env.PORT || 8888; 

server.listen(1883, () => {
    console.log(`📡 MQTT Broker is running on port 1883`);
});

ws.createServer({ server: httpServer }, aedes.handle);
httpServer.listen(PORT, () => {
    console.log(`🌐 WebSocket Broker (UI) is running on port ${PORT}`);
});