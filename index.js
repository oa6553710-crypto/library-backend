const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- إعدادات النظام والكتب ---
const ADMIN_CARD = "34FA78A3"; 
const BOOKS = {
    "AF69101C": "Circuits", 
    "7135704C": "Math",
    "71D8714C": "Network"
};

// --- قراءة الـ ID من Vercel بشكل صحيح ---
const MY_SHEET_ID = process.env.SHEET_ID || "1hpD4Tgm9qU13_e_L22RxG9SA8cZ9oKQhYYjB9_4BtR0";

// --- وظيفة جلب الحالة من الشيت ---
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
            systemActive = (adminRows[adminRows.length - 1][2] === "System ACTIVE");
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
        if (credentials.private_key) credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
        const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
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
    } catch (e) { console.error('Logging Error:', e.message); }
}

app.get('/api/status', async (req, res) => {
    const { systemActive } = await getStatusFromSheet();
    res.json({ isSystemActive: systemActive });
});

app.post('/api/scan', async (req, res) => {
    const { tagId } = req.body;
    const { systemActive, lastBookStatus } = await getStatusFromSheet(tagId);

    if (tagId === ADMIN_CARD) {
        const newStatus = !systemActive;
        const adminMsg = newStatus ? "System ACTIVE" : "System LOCKED";
        await logToSheet(tagId, "Admin Control", adminMsg);
        return res.json({ status: adminMsg });
    }

    if (!systemActive) {
        return res.json({ status: "Access Denied" });
    }

    if (BOOKS[tagId]) {
        const bookName = BOOKS[tagId];
        const newState = (lastBookStatus === "Borrowed") ? "Returned" : "Borrowed";
        await logToSheet(tagId, bookName, newState);
        return res.json({ status: `${bookName}:${newState === "Borrowed" ? "BRW" : "RTN"}` });
    }

    return res.json({ status: "Unknown Card" });
});

app.get('/api/logs', async (req, res) => {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: MY_SHEET_ID,
            range: 'Sheet1!A:E',
        });
        res.json(response.data.values || []);
    } catch (e) {
        res.json([]);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Backend Ready`));
module.exports = app;