require('dotenv').config();
const mqtt = require('mqtt');
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

// --- Configuration & Constants ---
const ADMIN_CARD = '34FA78A3';
const BOOKS = {
    'AF69101C': 'Circuits',
    '7135704C': 'Math',
    '71D8714C': 'Network'
};

const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
const MY_SHEET_ID = process.env.SHEET_ID;
const PORT = process.env.PORT || 3000;

const app = express();

// CORS configuration for GitHub Pages frontend
app.use(cors({
    origin: ['https://oa6553710-crypto.github.io', 'http://localhost:3000', 'http://localhost:8080'],
    credentials: true
}));
app.use(express.json());

const client = mqtt.connect(MQTT_BROKER_URL);

client.on('connect', () => {
    console.log(`🔌 Backend connected to MQTT broker at ${MQTT_BROKER_URL}`);
    client.subscribe(['library/scan', 'library/request_status'], { qos: 0 }, (err) => {
        if (err) console.error('Subscribe error:', err.message);
    });
});

client.on('error', (err) => {
    console.error('MQTT error:', err.message);
});

async function getStatusFromSheet(targetTagId = null) {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
        });
        const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: MY_SHEET_ID,
            range: 'Sheet1!A:E'
        });
        const rows = response.data.values || [];

        let systemActive = false;
        const adminRows = rows.filter((row) => row[0] === ADMIN_CARD);
        if (adminRows.length > 0) {
            const lastStatus = (adminRows[adminRows.length - 1][2] || '').trim().toUpperCase();
            systemActive = lastStatus === 'SYSTEM ACTIVE';
        }

        let lastBookStatus = 'Returned';
        if (targetTagId) {
            const bookRows = rows.filter((row) => row[0] === targetTagId);
            if (bookRows.length > 0) {
                lastBookStatus = (bookRows[bookRows.length - 1][2] || 'Returned');
            }
        }

        return { systemActive, lastBookStatus };
    } catch (error) {
        console.error('Sync Error:', error.message);
        return { systemActive: false, lastBookStatus: 'Returned' };
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
        const dateStr = now.toLocaleDateString('en-GB', { timeZone: 'Africa/Cairo' });
        const timeStr = now.toLocaleTimeString('en-GB', { timeZone: 'Africa/Cairo' });

        await sheets.spreadsheets.values.append({
            spreadsheetId: MY_SHEET_ID,
            range: 'Sheet1!A:E',
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[tagId, bookName, status, dateStr, timeStr]] }
        });
    } catch (error) {
        console.error('Logging Error:', error.message);
    }
}

function publish(topic, payload, retain = false) {
    client.publish(topic, JSON.stringify(payload), { qos: 0, retain }, (err) => {
        if (err) console.error(`Publish error on ${topic}:`, err.message);
    });
}

async function handleScan(tagId) {
    const { systemActive, lastBookStatus } = await getStatusFromSheet(tagId);
    let statusResponse = '';
    let newSystemState = systemActive;

    if (tagId === ADMIN_CARD) {
        newSystemState = !systemActive;
        statusResponse = newSystemState ? 'System ACTIVE' : 'System LOCKED';
        await logToSheet(tagId, 'Admin Control', statusResponse);
        publish('library/status', { isSystemActive: newSystemState }, true);
    } else if (!systemActive) {
        statusResponse = 'Access Denied';
    } else if (BOOKS[tagId]) {
        const bookName = BOOKS[tagId];
        const nextState = lastBookStatus === 'Borrowed' ? 'Returned' : 'Borrowed';
        statusResponse = `${bookName} ${nextState}`;
        await logToSheet(tagId, bookName, nextState);
    } else {
        statusResponse = 'Unknown Card';
    }

    publish('library/lcd', { status: statusResponse });
    publish('library/ui', {
        tagId,
        status: statusResponse,
        isSystemActive: newSystemState,
        time: new Date().toLocaleTimeString('en-GB', { timeZone: 'Africa/Cairo' })
    });
}

async function handleStatusRequest() {
    const { systemActive } = await getStatusFromSheet();
    publish('library/status', { isSystemActive: systemActive }, true);
}

client.on('message', async (topic, message) => {
    try {
        if (topic === 'library/scan') {
            const data = JSON.parse(message.toString());
            await handleScan(data.tagId);
        } else if (topic === 'library/request_status') {
            await handleStatusRequest();
        }
    } catch (error) {
        console.error('Message handler error:', error.message);
    }
});

app.get('/logs', async (req, res) => {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
        });
        const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: MY_SHEET_ID,
            range: 'Sheet1!A:E'
        });
        res.json(response.data.values || []);
    } catch (error) {
        console.error('API Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🌐 Backend API running on port ${PORT}`);
    console.log(`🧠 Backend logic listening to MQTT broker at ${MQTT_BROKER_URL}`);
});