const express = require('express');
const mqtt = require('mqtt');
const { google } = require('googleapis');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// الـ IDs (تأكد إنها صح)
const ADMIN_CARD = "A1B2C3D4"; 
const BOOKS_CARDS = ["B1B1B1B1", "C2C2C2C2", "D3D3D3D3"];
let isSystemActive = false;

// إعدادات جوجل (بناخدها من الـ Environment Variables)
const SPREADSHEET_ID = process.env.SHEET_ID;
const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

const mqttClient = mqtt.connect('mqtt://broker.hivemq.com');

mqttClient.on('connect', () => {
    mqttClient.subscribe('library/scan');
});

mqttClient.on('message', async (topic, message) => {
    const tagId = message.toString().toUpperCase();
    const timestamp = new Date().toLocaleString("en-GB", { timeZone: "Africa/Cairo" });

    if (tagId === ADMIN_CARD) {
        isSystemActive = !isSystemActive;
        mqttClient.publish('library/status', isSystemActive ? "System: ACTIVE" : "System: OFF");
        return;
    }

    if (isSystemActive && BOOKS_CARDS.includes(tagId)) {
        try {
            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: 'Sheet1!A:C',
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[timestamp, tagId, "Logged"]] },
            });
            mqttClient.publish('library/status', "Book Logged!");
        } catch (e) { console.log(e); }
    }
});

// الـ API اللي الـ Frontend هيكلمها
app.get('/api/logs', async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!A:C',
        });
        res.json(response.data.values || []);
    } catch (err) {
        res.status(500).json([]);
    }
});

// دي أهم حتة لـ Vercel:
module.exports = app;