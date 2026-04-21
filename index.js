const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());


// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
// الـ Rules بتاعتك هنا
const ADMIN_CARD = "A1B2C3D4"; 
const BOOKS_CARDS = ["B1B1B1B1", "C2C2C2C2"];
let isSystemActive = false; 

// endpoint لاستقبال البيانات من الـ ESP32
app.post('/api/scan', async (req, res) => {
    const { tagId } = req.body;
    const timestamp = new Date().toLocaleString("en-GB", { timeZone: "Africa/Cairo" });

    // Rule 1: كارت الأدمن يفتح ويقفل السيستم
    if (tagId === ADMIN_CARD) {
        isSystemActive = !isSystemActive;
        console.log(`System ${isSystemActive ? 'ACTIVATED' : 'DEACTIVATED'} by Admin Card`);
        
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
                requestBody: { values: [[timestamp, tagId, isSystemActive ? "System ACTIVE" : "System OFF"]] },
            });
        } catch (e) {
            console.error('Failed to log admin action:', e);
        }
        
        return res.json({ status: isSystemActive ? "System ACTIVE" : "System OFF" });
    }

    // Rule 2: لو السيستم مقفول، سجل الحدث
    if (!isSystemActive) {
        console.log('Scan rejected: System Locked');
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
                requestBody: { values: [[timestamp, tagId, "System Locked"]] },
            });
        } catch (e) {
            console.error('Failed to log locked system:', e);
        }
        return res.json({ status: "System Locked" });
    }

    // Rule 3: لو كارت كتاب، سجله في جوجل شيت
    if (BOOKS_CARDS.includes(tagId)) {
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
                requestBody: { values: [[timestamp, tagId, "Borrowed"]] },
            });
            console.log(`Book ${tagId} borrowed at ${timestamp}`);
            return res.json({ status: "Book Logged!" });
        } catch (e) {
            console.error('Google Sheets error:', e);
            return res.status(500).json({ status: "DB Error" });
        }
    }

    // Unknown card
    console.log(`Unknown card scanned: ${tagId}`);
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
            requestBody: { values: [[timestamp, tagId, "Unknown Card"]] },
        });
    } catch (e) {
        console.error('Failed to log unknown card:', e);
    }
    
    res.json({ status: "Unknown Card" });
});

// API لعرض كل الـ logs من Google Sheets (للـ Dashboard)
app.get('/api/logs', async (req, res) => {
    try {
        if (!process.env.GOOGLE_SERVICE_ACCOUNT || !process.env.SHEET_ID) {
            // Return mock data when credentials are not configured
            console.log('Google Sheets not configured, returning mock data');
            const mockData = [
                [new Date().toLocaleString("en-GB", { timeZone: "Africa/Cairo" }), "B1B1B1B1", "Borrowed"],
                [new Date(Date.now() - 3600000).toLocaleString("en-GB", { timeZone: "Africa/Cairo" }), "C2C2C2C2", "Borrowed"],
                [new Date(Date.now() - 7200000).toLocaleString("en-GB", { timeZone: "Africa/Cairo" }), "B1B1B1B1", "Borrowed"],
            ];
            return res.json(mockData);
        }
        
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SHEET_ID,
            range: 'Sheet1!A:C', // Timestamp, Tag ID, Status
        });
        
        const rows = response.data.values || [];
        console.log(`Logs fetched: ${rows.length} records`);
        res.json(rows);
    } catch (e) {
        console.error('Error fetching logs:', e);
        // Return mock data on error
        const mockData = [
            [new Date().toLocaleString("en-GB", { timeZone: "Africa/Cairo" }), "B1B1B1B1", "Borrowed"],
            [new Date(Date.now() - 3600000).toLocaleString("en-GB", { timeZone: "Africa/Cairo" }), "C2C2C2C2", "Borrowed"],
            [new Date(Date.now() - 7200000).toLocaleString("en-GB", { timeZone: "Africa/Cairo" }), "B1B1B1B1", "Borrowed"],
        ];
        res.json(mockData);
    }
});

// API للحصول على حالة النظام الحالية (للـ Home Page)
app.get('/api/status', (req, res) => {
    res.json({ 
        isSystemActive,
        adminCard: ADMIN_CARD,
        booksCards: BOOKS_CARDS,
        totalBooks: BOOKS_CARDS.length,
        lastUpdate: new Date().toISOString()
    });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        systemActive: isSystemActive 
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Smart Library Server running on port ${PORT}`);
    console.log(`📊 System Status: ${isSystemActive ? 'ACTIVE' : 'OFFLINE'}`);
    console.log(`🔑 Admin Card: ${ADMIN_CARD}`);
    console.log(`📚 Book Cards: ${BOOKS_CARDS.join(', ')}`);
});

module.exports = app;