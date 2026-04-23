const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());

// تشغيل الملفات الستاتيك (للوجهة الأمامية)
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

// الحالة الافتراضية عند تشغيل السيرفر هي LOCKED
let isSystemActive = false; 
let booksStatus = {}; // لحفظ حالة كل كتاب (Borrowed/Returned)

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
        console.error('Google Sheets Error:', e.message);
    }
}

// --- الـ Endpoint الأساسي لاستقبال الكروت ---
app.post('/api/scan', async (req, res) => {
    const { tagId } = req.body;
    const timestamp = new Date().toLocaleString("en-GB", { timeZone: "Africa/Cairo" });

    // 1. تشييك كارت الأدمن (يفتح ويقفل السيستم)
    if (tagId === ADMIN_CARD) {
        isSystemActive = !isSystemActive;
        const adminMsg = isSystemActive ? "System ACTIVE" : "System LOCKED";
        await logToSheet(timestamp, tagId, adminMsg);
        console.log(`Admin Toggled System to: ${adminMsg}`);
        return res.json({ status: adminMsg });
    }

    // 2. لو السيستم مقفول (LOCKED) وحاولت تسحب أي كارت تاني
    if (!isSystemActive) {
        console.log(`Access Denied for Tag: ${tagId}`);
        // بنبعت Access Denied عشان الـ ESP32 تعرضها وترجع لـ LOCKED
        return res.json({ status: "Access Denied" });
    }

    // 3. لو السيستم مفتوح (ACTIVE) والتاغ كارت كتاب معروف
    if (BOOKS[tagId]) {
        const bookName = BOOKS[tagId];
        
        // تبديل حالة الكتاب (Borrowed <-> Returned)
        if (!booksStatus[tagId] || booksStatus[tagId] === "Returned") {
            booksStatus[tagId] = "Borrowed";
        } else {
            booksStatus[tagId] = "Returned";
        }

        const state = booksStatus[tagId];
        const displayMsg = `${bookName}:${state === "Borrowed" ? "BRW" : "RTN"}`;
        
        await logToSheet(timestamp, tagId, `${bookName} ${state}`);
        console.log(`Book Logged: ${displayMsg}`);
        
        return res.json({ status: displayMsg }); 
    }

    // 4. كارت غريب والسيستم مفتوح
    return res.json({ status: "Unknown Card" });
});

// APIs إضافية للـ Dashboard
app.get('/api/status', (req, res) => {
    res.json({ isSystemActive, booksStatus });
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
    } catch (e) {
        res.json([]);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Smart Library Backend Running...`);
});

module.exports = app;