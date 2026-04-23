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
    "AF69101C": "Circuits Book",
    "7135704C": "Math Book",
    "71D8714C": "Network Book"
};
const BOOKS_CARDS = Object.keys(BOOKS);
let isSystemActive = false; 

// وظيفة مساعدة لتسجيل البيانات في Google Sheets
async function logToSheet(timestamp, tagId, status) {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.SHEET_ID,
            range: 'Sheet1!A:C',
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[timestamp, tagId, status]] },
        });
    } catch (e) {
        console.error('Sheet Logging Error:', e.message);
    }
}

app.post('/api/scan', async (req, res) => {
    const { tagId } = req.body;
    const timestamp = new Date().toLocaleString("en-GB", { timeZone: "Africa/Cairo" });

    // 1. كارت الأدمن (تغيير حالة النظام)
    if (tagId === ADMIN_CARD) {
        isSystemActive = !isSystemActive;
        const adminStatus = isSystemActive ? "System ACTIVE" : "System LOCKED";
        
        await logToSheet(timestamp, tagId, adminStatus);
        
        console.log(adminStatus);
        return res.json({ status: adminStatus });
    }

    // 2. لو السيستم مقفول (LOCKED)
    if (!isSystemActive) {
        await logToSheet(timestamp, tagId, "Rejected: Locked");
        return res.json({ status: "System LOCKED" });
    }

    // 3. لو السيستم مفتوح وكارت كتاب معروف
    if (BOOKS[tagId]) {
        const bookName = BOOKS[tagId];
        await logToSheet(timestamp, tagId, `Borrowed: ${bookName}`);
        
        console.log(`${bookName} Borrowed`);
        // بنبعت اسم الكتاب عشان يظهر على السطر الأول والحالة على السطر التاني في الـ LCD
        return res.json({ status: bookName }); 
    }

    // 4. كارت غير معروف والسيستم مفتوح
    await logToSheet(timestamp, tagId, "Unknown Card");
    res.json({ status: "Unknown Card" });
});

// باقي الـ Endpoints (logs, status, health) كما هي في كودك الأصلي...
app.get('/api/status', (req, res) => {
    res.json({ isSystemActive, adminCard: ADMIN_CARD, totalBooks: BOOKS_CARDS.length });
});

app.get('/api/logs', async (req, res) => {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SHEET_ID,
            range: 'Sheet1!A:C',
        });
        res.json(response.data.values || []);
    } catch (e) { res.json([]); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT} | Status: ${isSystemActive ? 'ACTIVE' : 'LOCKED'}`);
});

module.exports = app;