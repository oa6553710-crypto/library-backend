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

// --- إعدادات النظام والكتب (تأكد من الـ IDs الخاصة بكروتِك) ---
const ADMIN_CARD = "34FA78A3"; 
const BOOKS = {
    "AF69101C": "Circuits", 
    "7135704C": "Math",
    "71D8714C": "Network"
};

// --- إعدادات الجوجل شيت (انسخ الـ ID بتاعك هنا) ---
const MY_SHEET_ID = "1hpD4Tgm9qU13_e_L22RxG9SA8cZ9oKQhYYjB9_4BtR0"; // <--- حط الـ ID بتاع الشيت بتاعك هنا

let isSystemActive = false; 
let booksStatus = {}; 

// وظيفة لتسجيل البيانات في Google Sheets
async function logToSheet(timestamp, tagId, status) {
    try {
        // التأكد من وجود بيانات الـ Service Account في Vercel
        if (!process.env.GOOGLE_SERVICE_ACCOUNT) {
            console.error("Missing GOOGLE_SERVICE_ACCOUNT in Vercel Variables!");
            return;
        }

        const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
        
        // تصحيح الـ Private Key (مهم جداً لبيئة Vercel)
        if (credentials.private_key) {
            credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
        }

        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const sheets = google.sheets({ version: 'v4', auth });

        await sheets.spreadsheets.values.append({
            spreadsheetId: MY_SHEET_ID,
            range: 'Sheet1!A:C',
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[timestamp, tagId, status]] },
        });
        console.log(`Sheet updated: ${status}`);
    } catch (e) {
        console.error('Google Sheets Error:', e.message);
    }
}

// --- 1. Endpoint المزامنة عند التشغيل ---
app.get('/api/status', (req, res) => {
    res.json({ isSystemActive: isSystemActive });
    console.log("Checking Env Variable...");
if (process.env.GOOGLE_SERVICE_ACCOUNT) {
    console.log("Variable EXISTS ✅");
    try {
        const testJson = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
        console.log("JSON is VALID! Email is: " + testJson.client_email);
    } catch (e) {
        console.log("JSON is INVALID ❌: " + e.message);
    }
} else {
    console.log("Variable is MISSING ❌");
}
});

// --- 2. Endpoint المسح الأساسي ---
app.post('/api/scan', async (req, res) => {
    const { tagId } = req.body;
    const timestamp = new Date().toLocaleString("en-GB", { timeZone: "Africa/Cairo" });

    // أ- كارت الأدمن (يفتح ويقفل السيستم)
    if (tagId === ADMIN_CARD) {
        isSystemActive = !isSystemActive;
        const adminMsg = isSystemActive ? "System ACTIVE" : "System LOCKED";
        await logToSheet(timestamp, tagId, adminMsg);
        return res.json({ status: adminMsg });
    }

    // ب- لو السيستم مقفول (LOCKED)
    if (!isSystemActive) {
        return res.json({ status: "Access Denied" });
    }

    // ج- لو السيستم مفتوح (ACTIVE) وكارت كتاب معروف
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
        return res.json({ status: displayMsg }); 
    }

    // د- كارت غريب
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
            range: 'Sheet1!A:C',
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