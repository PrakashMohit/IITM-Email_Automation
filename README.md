# IITM Placement Cell — HR Email Automation

## Folder Structure
```
iitm-mailer/
├── server.js          ← Node.js backend (handles email sending + Gemini)
├── package.json       ← Dependencies
├── public/
│   └── index.html     ← Frontend (deploy this or serve via server.js)
└── README.md
```

## Step 1 — Get Gmail App Password

1. Go to myaccount.google.com → Security → Turn ON 2-Step Verification
2. Go to myaccount.google.com/apppasswords
3. App name: "IITM Mailer" → Create
4. Copy the 16-character code (e.g. `abcd efgh ijkl mnop`)

## Step 2 — Get Free Gemini API Key

1. Go to https://aistudio.google.com
2. Click "Get API Key" → Create API Key
3. Copy the key (starts with AIza...)

## Step 3 — Deploy Backend on Render.com (Free)

1. Create account at render.com
2. New → Web Service → Connect GitHub (upload this folder to GitHub first)
3. Settings:
   - Build Command: `npm install`
   - Start Command: `node server.js`
4. Add Environment Variables:
   - `GMAIL_USER` = your-email@gmail.com
   - `GMAIL_PASS` = your 16-char app password
   - `GEMINI_KEY` = your Gemini API key
5. Deploy! You get a URL like: https://iitm-mailer.onrender.com

## Step 4 — Use the App

1. Open your Render URL (or index.html locally)
2. Paste the Render URL in the sidebar "Backend URL" field
3. Go to Setup & Keys → add Gemini key + Gmail
4. Recipients → upload your Google Sheet CSV
5. Compose → preview AI-generated emails
6. Send Campaign → click Start!

## Google Sheet Export (CSV)
File → Download → Comma Separated Values (.csv)
OR File → Share → Publish to web → CSV (for auto-polling)

## Columns expected (in order):
S No | Date | Company Name | Job Post | Job Post Link | Email ID
