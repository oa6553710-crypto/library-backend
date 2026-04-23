const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());

// تشغيل الملفات الستاتيك للـ Dashboard
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- إعدادات السيستم والكتب ---
const ADMIN_CARD = "34FA78A3"; 
const BOOKS = {
    "AF69101C": "Circuits", // خليت الأسامي مختصرة عشان مساحة الـ LCD
    "7135704C": "Math",
    "71D8714C": "Network"
};

let isSystemActive = false; 
let booksStatus = {}; // متغير لحفظ حالة الكتب (استعارة ولا ترجيع)

// وظيفة لتسجيل البيانات في Google Sheets
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
        console.error('Sheet Error:', e.message);
    }
}

// --- الـ Endpoint الأساسي ---
app.post('/api/scan', async (req, res) => {
    const { tagId } = req.body;
    const timestamp = new Date().toLocaleString("en-GB", { timeZone: "Africa/Cairo" });

    // 1. كارت الأدمن (فتح وقفل النظام)
    if (tagId === ADMIN_CARD) {
        isSystemActive = !isSystemActive;
        const adminMsg = isSystemActive ? "System ACTIVE" : "System LOCKED";
        await logToSheet(timestamp, tagId, adminMsg);
        return res.json({ status: adminMsg });
    }

    // 2. لو السيستم مقفول (LOCKED)
    if (!isSystemActive) {
        return res.json({ status: "System LOCKED" });
    }

    // 3. لو كارت كتاب معروف والسيستم ACTIVE
    if (BOOKS[tagId]) {
        const bookName = BOOKS[tagId];
        
        // تبديل الحالة (Toggle Logic)
        if (!booksStatus[tagId] || booksStatus[tagId] === "Returned") {
            booksStatus[tagId] = "Borrowed";
        } else {
            booksStatus[tagId] = "Returned";
        }

        const state = booksStatus[tagId];
        const displayMsg = `${bookName}:${state === "Borrowed" ? "BRW" : "RTN"}`;
        
        await logToSheet(timestamp, tagId, state); // تسجيل الحالة (Borrowed/Returned) في الشيت
        console.log(`Log: ${displayMsg}`);
        
        return res.json({ status: displayMsg }); 
    }

    // 4. كارت غير معروف والسيستم مفتوح
    await logToSheet(timestamp, tagId, "Unknown Card");
    res.json({ status: "Unknown Card" });
});

// باقي الـ APIs للـ Dashboard
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
    } catch (e) { res.status(500).json([]); }
});

app.get('/api/status', (req, res) => {
    res.json({ isSystemActive });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Smart Library Server on port ${PORT}`);
});

module.exports = app;