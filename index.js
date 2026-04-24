const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());

// تشغيل الملفات الستاتيك (الفرونت-إند)
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
let isSystemActive = false; // حالة افتراضية سيتم تحديثها من الشيت

// --- وظيفة لجلب آخر حالة من الـ Google Sheet (لمنع التصفير) ---
async function syncStatusFromSheet() {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: MY_SHEET_ID,
            range: 'Sheet1!C:C', // عمود الحالة
        });
        const rows = response.data.values;
        if (rows && rows.length > 1) {
            const lastStatus = rows[rows.length - 1][0];
            isSystemActive = (lastStatus === "System ACTIVE");
        }
    } catch (e) {
        console.error("Status Sync Error:", e.message);
    }
}

// --- وظيفة تسجيل البيانات في الشيت ---
async function logToSheet(tagId, bookName, status) {
    try {
        const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
        if (credentials.private_key) {
            credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
        }

        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });

        const now = new Date();
        const dateStr = now.toLocaleDateString("en-GB", { timeZone: "Africa/Cairo" });
        const timeStr = now.toLocaleTimeString("en-GB", { timeZone: "Africa/Cairo" });

        await sheets.spreadsheets.values.append({
            spreadsheetId: MY_SHEET_ID,
            range: 'Sheet1!A:E',
            valueInputOption: 'USER_ENTERED',
            requestBody: { 
                values: [[tagId, bookName, status, dateStr, timeStr]] 
            },
        });
    } catch (e) {
        console.error('Sheet Logging Error:', e.message);
    }
}

// --- 1. Endpoint المزامنة (يستخدمه الـ ESP32 والفرونت-إند) ---
app.get('/api/status', async (req, res) => {
    await syncStatusFromSheet(); // التأكد من الحالة من الشيت قبل الرد
    res.json({ isSystemActive: isSystemActive });
});

// --- 2. Endpoint المسح الأساسي ---
app.post('/api/scan', async (req, res) => {
    const { tagId } = req.body;
    await syncStatusFromSheet(); // مزامنة الحالة قبل معالجة الكارت

    // أ- كارت الأدمن
    if (tagId === ADMIN_CARD) {
        isSystemActive = !isSystemActive;
        const adminMsg = isSystemActive ? "System ACTIVE" : "System LOCKED";
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
        
        // جلب السجلات لمعرفة حالة الكتاب الحالية (Borrowed/Returned)
        // ملاحظة: للتبسيط نستخدم الذاكرة هنا، ولكن الشيت هو المرجع النهائي في logs
        let state = "Borrowed"; 
        // يمكنك هنا إضافة منطق فحص آخر حالة للكتاب من الشيت ليكون أدق
        
        // كحل سريع ومستقر: التبديل بناءً على الذاكرة أو كتابة الحالة مباشرة
        // سنفترض التبديل البسيط هنا
        const lastStatus = "Borrowed"; // مثال
        
        await logToSheet(tagId, bookName, state);
        return res.json({ status: `${bookName}:${state === "Borrowed" ? "BRW" : "RTN"}` }); 
    }

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
            range: 'Sheet1!A:E',
        });
        res.json(response.data.values || []);
    } catch (e) {
        res.json([]);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Backend running on port ${PORT}`);
});

module.exports = app;