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

// --- إعدادات السيستم والكتب ---
const ADMIN_CARD = "34FA78A3"; 
const BOOKS = {
    "AF69101C": "Circuits", 
    "7135704C": "Math",
    "71D8714C": "Network"
};

let isSystemActive = false; 
let booksStatus = {}; 

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

app.post('/api/scan', async (req, res) => {
    const { tagId } = req.body;
    const timestamp = new Date().toLocaleString("en-GB", { timeZone: "Africa/Cairo" });

    // 1. تشييك الأول: هل ده كارت أدمن؟
    if (tagId === ADMIN_CARD) {
        isSystemActive = !isSystemActive; // بيعكس الحالة بس للأدمن
        const adminMsg = isSystemActive ? "System ACTIVE" : "System LOCKED";
        await logToSheet(timestamp, tagId, adminMsg);
        return res.json({ status: adminMsg });
    }

    // 2. لو مش أدمن.. نكشف على حالة السيستم
    if (!isSystemActive) {
        // لو السيستم مقفول، أي كارت تاني يترفض وميغيرش حالة السيستم
        return res.json({ status: "System LOCKED" });
    }

    // 3. لو السيستم مفتوح (ACTIVE) والتاغ ده كارت كتاب معروف
    if (BOOKS[tagId]) {
        const bookName = BOOKS[tagId];
        
        // تبديل حالة الكتاب (BRW/RTN) - ده ملوش دعوة بـ isSystemActive
        if (!booksStatus[tagId] || booksStatus[tagId] === "Returned") {
            booksStatus[tagId] = "Borrowed";
        } else {
            booksStatus[tagId] = "Returned";
        }

        const state = booksStatus[tagId];
        const displayMsg = `${bookName}:${state === "Borrowed" ? "BRW" : "RTN"}`;
        
        await logToSheet(timestamp, tagId, `${bookName} ${state}`);
        return res.json({ status: displayMsg }); 
    }

    // 4. لو كارت غريب والسيستم مفتوح
    return res.json({ status: "Unknown Card" });
});

app.get('/api/status', (req, res) => {
    res.json({ isSystemActive });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Smart Library Server Ready`);
});

module.exports = app;