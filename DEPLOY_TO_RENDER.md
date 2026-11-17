# 🚀 Deploying SecureGate AI to Render

This guide walks you through deploying the complete **SecureGate AI** full-stack system to [Render](https://render.com) for production cloud hosting with automatic HTTPS.

---

## 📋 Prerequisites

1. A free [GitHub](https://github.com) account.
2. A free [Render](https://render.com) account.
3. A free [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) cloud database cluster.

---

## 🗄️ Step 1: Set Up Free MongoDB Atlas (Cloud Database)

Render web services run in ephemeral cloud containers, so your database must be hosted in the cloud:

1. Log in to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas).
2. Click **Create Deployment** &rarr; Select the **M0 Free Tier** &rarr; Choose a cloud provider and region (e.g., AWS / Mumbai or Singapore).
3. Under **Security Quickstart**:
   - Create a database user (e.g., `securegate_user` with a strong password).
   - Under **Network Access (IP Access List)**, add `0.0.0.0/0` (Allow Access from Anywhere) so Render can connect.
4. Click **Connect** &rarr; Choose **Drivers (Node.js)** &rarr; Copy the connection string:
   ```text
   mongodb+srv://securegate_user:<password>@cluster0.abcde.mongodb.net/securegate_db?retryWrites=true&w=majority
   ```
   *(Replace `<password>` with your database password).*

---

## 🐙 Step 2: Push Your Project to GitHub

In your project folder (`secure gate`), push the code to a new GitHub repository:

```bash
git init
git add .
git commit -m "Prepare SecureGate AI for Render deployment"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/securegate-ai.git
git push -u origin main
```

*(Note: `.env` is automatically ignored by `.gitignore` to keep your passwords secure).*

---

## ☁️ Step 3: Deploy on Render

### Option A: Using the Render Blueprint (`render.yaml`) — Recommended
1. Open [Render Dashboard](https://dashboard.render.com).
2. Click **New +** &rarr; Select **Blueprint**.
3. Connect your `securegate-ai` GitHub repository.
4. Render will detect `render.yaml` and configure the Web Service automatically!
5. In the configuration screen, set your `MONGODB_URI` from Step 1.
6. Click **Apply** to deploy!

### Option B: Manual Web Service Setup
1. In Render Dashboard, click **New +** &rarr; Select **Web Service**.
2. Connect your GitHub repository.
3. Configure the settings:
   - **Name**: `securegate-ai`
   - **Region**: Oregon or Singapore
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`
4. Under **Environment Variables**, click **Add Environment Variable** and enter:

| Key | Value | Description |
|---|---|---|
| `NODE_ENV` | `production` | Production environment mode |
| `PORT` | `10000` | Port assigned by Render |
| `MONGODB_URI` | `mongodb+srv://...` | Your MongoDB Atlas connection URI |
| `JWT_SECRET` | *(Random 32+ character string)* | Secret for admin authentication tokens |
| `DEVICE_ID` | `ESP32_SECUREGATE_01` | Matching identifier for your ESP32 |
| `DEVICE_API_KEY` | `SG-DEV-KEY-98472910-ESP32-AUTH-TOKEN` | Shared device secret |
| `SMTP_HOST` | `smtp.gmail.com` | Google SMTP Host |
| `SMTP_PORT` | `587` | TLS Port |
| `SMTP_SECURE` | `false` | TLS (not SSL 465) |
| `SMTP_USER` | `muthmares06@gmail.com` | Your configured Gmail address |
| `SMTP_PASS` | `nyjomnbqheytorgu` | Your Google 16-character App Password |
| `SMTP_FROM_NAME` | `SecureGate AI` | Display name for emails |
| `SMTP_FROM_EMAIL` | `muthmares06@gmail.com` | Sender email |
| `EMAIL_SIMULATION_MODE` | `false` | Live email delivery enabled |
| `SMS_SIMULATION_MODE` | `true` | Mobile SMS simulation |

5. Click **Create Web Service**. Render will build and deploy your project!

---

## 🌐 Step 4: Verify Your Live Cloud Application

Once Render finishes deploying, your application will have a public HTTPS URL (e.g., `https://securegate-ai.onrender.com`):

- **Home Portal**: `https://securegate-ai.onrender.com`
- **Admin Dashboard**: `https://securegate-ai.onrender.com/admin.html`
  - Default Login: `admin@securegate.local` / `adminpassword123`
- **RFID Terminal**: `https://securegate-ai.onrender.com/user.html`
- **Visitor Request**: `https://securegate-ai.onrender.com/visitor.html`

> [!NOTE]
> Render provides free, automatic SSL certificates (`https://`), so the **Web Serial USB Reader** will work in any Chrome or Brave browser worldwide!

---

## 📡 Step 5: Update Your ESP32 Firmware for the Cloud

Open [esp32/SecureGateAI_Direct.ino](esp32/SecureGateAI_Direct.ino) in Arduino IDE:

1. Update line 43 with your live Render HTTPS URL:
   ```cpp
   const char* BACKEND_SERVER = "https://securegate-ai.onrender.com";
   ```
2. Upload the sketch to your ESP32.
3. The ESP32 will now connect to the cloud server using secure HTTPS via `WiFiClientSecure`!
