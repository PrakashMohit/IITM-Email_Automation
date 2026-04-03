// ============================================================
// IITM Placement Cell — Email Backend
// Deploy FREE on Render.com (render.com/new/web-service)
// ============================================================
const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public')); // serves your index.html

// ─── ENV VARS (set these on Render dashboard, never hardcode) ───
const GMAIL_USER  = process.env.GMAIL_USER;
const GMAIL_PASS  = process.env.GMAIL_PASS;  // Gmail App Password (16-char)
const GEMINI_KEY  = process.env.GEMINI_KEY;
const PORT        = process.env.PORT || 3000;

// ─── Gmail transporter ──────────────────────────────────────────
function makeTransporter(userEmail, appPassword) {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: userEmail || GMAIL_USER, pass: appPassword || GMAIL_PASS }
  });
}

// ─── HEALTH CHECK ───────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ─── TEST GMAIL CONNECTION ───────────────────────────────────────
app.post('/api/test-gmail', async (req, res) => {
  const { email, appPassword } = req.body;
  try {
    const t = makeTransporter(email, appPassword);
    await t.verify();
    res.json({ ok: true, message: 'Gmail connected successfully!' });
  } catch (e) {
    res.status(400).json({ ok: false, message: e.message });
  }
});

// ─── GENERATE EMAIL WITH GEMINI ─────────────────────────────────
app.post('/api/generate', async (req, res) => {
  const { prompt, geminiKey } = req.body;
  const key = geminiKey || GEMINI_KEY;
  if (!key) return res.status(400).json({ error: 'Gemini API key missing' });
  if (!prompt) return res.status(400).json({ error: 'Prompt missing' });

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.85,
            maxOutputTokens: 600,   // enough for 200-word email
            topP: 0.9
          }
        })
      }
    );
    const data = await response.json();
    if (!response.ok) {
      return res.status(500).json({ error: data.error?.message || 'Gemini error' });
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) return res.status(500).json({ error: 'Empty response from Gemini' });
    res.json({ ok: true, body: text.trim() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── SEND SINGLE EMAIL ──────────────────────────────────────────
app.post('/api/send', async (req, res) => {
  const { to, subject, body, fromName, fromEmail, appPassword, replyTo } = req.body;
  if (!to || !subject || !body) return res.status(400).json({ error: 'Missing to/subject/body' });

  try {
    const t = makeTransporter(fromEmail, appPassword);
    const info = await t.sendMail({
      from: `"${fromName || 'IITM Placement Cell'}" <${fromEmail || GMAIL_USER}>`,
      to,
      subject,
      text: body,
      html: body.replace(/\n/g, '<br>'),
      replyTo: replyTo || fromEmail || GMAIL_USER
    });
    console.log(`✓ Sent to ${to} | MessageId: ${info.messageId}`);
    res.json({ ok: true, messageId: info.messageId });
  } catch (e) {
    console.error(`✗ Failed to ${to}: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// ─── BULK SEND (generate + send all) ───────────────────────────
app.post('/api/bulk-send', async (req, res) => {
  // Used for server-side cron. Frontend does it one-by-one for live progress.
  // This endpoint handles a batch and returns results.
  const { recipients, promptTemplate, subjectTemplate, signature,
          fromName, fromEmail, appPassword, geminiKey, delayMs } = req.body;

  if (!recipients?.length) return res.status(400).json({ error: 'No recipients' });

  const key = geminiKey || GEMINI_KEY;
  const delay = delayMs || 3000;
  const results = [];

  for (const r of recipients) {
    await new Promise(resolve => setTimeout(resolve, delay));
    try {
      // Build prompt
      const prompt = buildPrompt(promptTemplate, r);
      // Generate
      const genRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.85, maxOutputTokens: 600 } }) }
      );
      const genData = await genRes.json();
      const emailBody = (genData.candidates?.[0]?.content?.parts?.[0]?.text || '').trim()
        + (signature ? '\n\n' + signature : '');

      // Send
      const subject = buildSubject(subjectTemplate, r);
      const t = makeTransporter(fromEmail, appPassword);
      await t.sendMail({
        from: `"${fromName}" <${fromEmail || GMAIL_USER}>`,
        to: r.email, subject,
        text: emailBody,
        html: emailBody.replace(/\n/g, '<br>')
      });
      results.push({ email: r.email, status: 'sent' });
      console.log(`✓ Sent to ${r.email}`);
    } catch (e) {
      results.push({ email: r.email, status: 'failed', error: e.message });
      console.error(`✗ ${r.email}: ${e.message}`);
    }
  }

  res.json({ ok: true, results });
});

function buildPrompt(template, r) {
  return template
    .replace(/{{hr_name}}/g, r.hrName || 'Hiring Manager')
    .replace(/{{company}}/g, r.company || '')
    .replace(/{{job_post}}/g, r.jobPost || '')
    .replace(/{{job_link}}/g, r.jobLink || 'LinkedIn')
    .replace(/{{domain}}/g, r.domain || 'technology');
}
function buildSubject(template, r) {
  return template
    .replace(/{{company}}/g, r.company || '')
    .replace(/{{job_post}}/g, r.jobPost || '')
    .replace(/{{hr_name}}/g, r.hrName || '')
    .replace(/{{domain}}/g, r.domain || '');
}

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
