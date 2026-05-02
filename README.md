# 📚 IoT Library Management System

An advanced IoT-based system for tracking library books using **ESP32**, **MQTT**, and **Google Sheets**. The system features a real-time web dashboard for monitoring book transactions and an admin lock-screen for security.

## 🚀 Features
*   **RFID Authentication:** Use a master Admin Card to lock/unlock the system.
*   **Real-time Monitoring:** Web dashboard updates instantly via WebSockets (MQTT).
*   **Cloud Logging:** Automatically logs every transaction (ID, Book Name, Status, Date, Time) to Google Sheets.
*   **Secure Access:** Only registered RFID tags can borrow or return books.
*   **Live Web Interface:** Hosted on GitHub Pages with a modern, responsive UI.

## 🛠️ Tech Stack
*   **Hardware:** ESP32, MFRC522 RFID Scanner, I2C LCD Display, Servo Motor.
*   **Backend:** Node.js running on **Railway**, using Aedes MQTT Broker.
*   **Frontend:** HTML5, Tailwind CSS, JavaScript (MQTT.js).
*   **Database:** Google Sheets API v4.

## 📡 System Architecture
1.  **ESP32** scans the RFID tag and sends the ID to the **Node.js Backend** via MQTT (Port 1883).
2.  **Backend** checks the tag against **Google Sheets** and determines the system status (Locked/Active).
3.  **Backend** publishes the result back to the **LCD** and sends a WebSocket message to the **Web Dashboard**.
4.  The **Web Dashboard** fetches historical logs directly from the Backend API.

## 🔧 Installation & Setup
1.  **Hardware:** Wire the MFRC522 and LCD to the ESP32 (Refer to the pinout in the code).
2.  **Backend:** 
    *   Deploy the `index.js` to Railway.
    *   Set Environment Variables: `SHEET_ID` and `GOOGLE_SERVICE_ACCOUNT`.
3.  **Frontend:**
    *   Update `BROKER_URL` and `API_HISTORY_URL` in `index.html`.
    *   Enable GitHub Pages in repository settings.

Developed by an Engineering Student at AAST.
OMAR AHMED

<img width="1794" height="1244" alt="image" src="https://github.com/user-attachments/assets/00bdf081-cdc3-4534-a6bb-f6104efbcd2b" />
<img width="1684" height="1109" alt="image" src="https://github.com/user-attachments/assets/3090f0d2-7799-4dab-afdc-1c4387679d69" />
