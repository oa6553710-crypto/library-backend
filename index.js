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

const MY_SHEET_ID = "1hpD4Tgm9qU13_e_L22RxG9SA8cZ9oKQhYYjB9_4BtR0";

let isSystemActive = false; 
let booksStatus = {}; 

// --- وظيفة تسجيل البيانات المعدلة لترتيب الأعمدة ---
async function logToSheet(tagId, bookName, status) {
    try {
        if (!process.env.GOOGLE_SERVICE_ACCOUNT) {
            console.error("Missing GOOGLE_SERVICE_ACCOUNT!");
            return;
        }

        const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
        if (credentials.private_key) {
            credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
        }

        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const sheets = google.sheets({ version: 'v4', auth });

        // تجهيز التاريخ والوقت منفصلين
        const now = new Date();
        const dateStr = now.toLocaleDateString("en-GB", { timeZone: "Africa/Cairo" });
        const timeStr = now.toLocaleTimeString("en-GB", { timeZone: "Africa/Cairo" });

        await sheets.spreadsheets.values.append({
            spreadsheetId: MY_SHEET_ID,
            range: 'Sheet1!A:E', // وسعنا المدى لـ 5 أعمدة (A, B, C, D, E)
            valueInputOption: 'USER_ENTERED',
            requestBody: { 
                // الترتيب: A: ID | B: Name | C: Status | D: Date | E: Time
                values: [[tagId, bookName, status, dateStr, timeStr]] 
            },
        });
        console.log(`Sheet Updated: ${bookName} - ${status}`);
    } catch (e) {
        console.error('Google Sheets Error:', e.message);
    }
}

// --- 1. Endpoint المزامنة ---
app.get('/api/status', (req, res) => {
    res.json({ isSystemActive: isSystemActive });
});

// --- 2. Endpoint المسح الأساسي ---
app.post('/api/scan', async (req, res) => {
    const { tagId } = req.body;

    // أ- كارت الأدمن
    if (tagId === ADMIN_CARD) {
        isSystemActive = !isSystemActive;
        const adminMsg = isSystemActive ? "System ACTIVE" : "System LOCKED";
        // بنبعت tagId واسم "Admin" والحالة
        await logToSheet(tagId, "Admin Control", adminMsg);
        return res.json({ status: adminMsg });
    }

    // ب- لو السيستم مقفول
    if (!isSystemActive) {
        return res.json({ status: "Access Denied" });
    }

    // ج- كارت كتاب معروف
    if (BOOKS[tagId]) {
        const bookName = BOOKS[tagId];
        
        if (!booksStatus[tagId] || booksStatus[tagId] === "Returned") {
            booksStatus[tagId] = "Borrowed";
        } else {
            booksStatus[tagId] = "Returned";
        }

        const state = booksStatus[tagId];
        const displayMsg = `${bookName}:${state === "Borrowed" ? "Borrowed" : "Returned"}`;
        
        // تسجيل البيانات بالترتيب الجديد
        await logToSheet(tagId, bookName, state);
        return res.json({ status: displayMsg }); 
    }

    // د- كارت غريب
    await logToSheet(tagId, "Unknown Tag", "Denied");
    return res.json({ status: "Unknown Card" });
});

// --- 3. Endpoint السجلات للـ Dashboard ---
app.get('/api/logs', async (req, res) => {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: MY_SHEET_ID,
            range: 'Sheet1!A:E', // عرض كل الأعمدة في الداشبورد
        });
        res.json(response.data.values || []);
    } catch (e) {
        res.json([]);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Smart Library Backend Ready`);
});

module.exports = app;