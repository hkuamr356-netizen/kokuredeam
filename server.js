/**
 * Yarwin Redeem Pro - Server (v4.0)
 * Features: Yaarwin APIs, key‑based login, bot endpoints, Telegram credential storage, allocation.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;

// ===== Configuration =====
const YARWIN_BASE = 'https://api.yaarwapi62in.com/api/webapi';
const PROJECT = 'ar095';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const ADMIN_MASTER_KEY = process.env.ADMIN_MASTER_KEY || 'admin123';

// ===== Middleware =====
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ===== Database (users.json) =====
const DB_FILE = path.join(__dirname, 'users.json');
function readDB() {
  if (!fs.existsSync(DB_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch(e) { return {}; }
}
function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ===== Helper: Generate key =====
function generateKey() {
  return crypto.randomBytes(6).toString('hex').toUpperCase();
}

// ===== Helper: Parse duration =====
function parseDuration(durationStr) {
  const match = durationStr.match(/^(\d+)([DdHh])$/);
  if (!match) return null;
  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === 'd') return value * 24 * 60 * 60 * 1000;
  if (unit === 'h') return value * 60 * 60 * 1000;
  return null;
}

// ===== Helper: Send Telegram notification =====
async function sendTelegramNotification(message) {
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) return;
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: ADMIN_CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    });
  } catch(e) { console.error('Telegram notification failed', e.message); }
}

// ===== API: Generate a new key with expiry =====
app.post('/api/admin/newkey', async (req, res) => {
  const { masterKey, duration } = req.body;
  if (masterKey !== ADMIN_MASTER_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const key = generateKey();
  const db = readDB();
  if (db[key]) {
    const newKey = generateKey();
    const expiresAt = duration ? Date.now() + parseDuration(duration) : null;
    db[newKey] = {
      key: newKey,
      ip: null,
      fingerprint: null,
      lastLogin: null,
      accounts: [],
      createdAt: new Date().toISOString(),
      expiresAt
    };
    writeDB(db);
    return res.json({ key: newKey, expiresAt });
  }
  const expiresAt = duration ? Date.now() + parseDuration(duration) : null;
  db[key] = {
    key,
    ip: null,
    fingerprint: null,
    lastLogin: null,
    accounts: [],
    createdAt: new Date().toISOString(),
    expiresAt
  };
  writeDB(db);
  res.json({ key, expiresAt });
});

// ===== API: Check if key is still valid =====
app.get('/api/check-key', (req, res) => {
  const { key } = req.query;
  if (!key) return res.json({ valid: false });
  const db = readDB();
  if (!db[key]) return res.json({ valid: false });
  if (db[key].expiresAt && db[key].expiresAt < Date.now()) return res.json({ valid: false });
  res.json({ valid: true });
});

// ===== API: Login with key =====
app.post('/api/login-key', async (req, res) => {
  const { key, fingerprint } = req.body;
  if (!key) return res.status(400).json({ error: 'Key is required' });
  const db = readDB();
  if (!db[key]) return res.status(401).json({ error: 'Invalid key' });
  if (db[key].expiresAt && db[key].expiresAt < Date.now()) {
    return res.status(401).json({ error: 'Key has expired' });
  }
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  db[key].ip = ip;
  db[key].fingerprint = fingerprint || 'unknown';
  db[key].lastLogin = new Date().toISOString();
  writeDB(db);
  const msg = `🔐 <b>New login</b>\nKey: <code>${key}</code>\nIP: ${ip}\nFingerprint: ${fingerprint || 'N/A'}\nTime: ${db[key].lastLogin}`;
  await sendTelegramNotification(msg);
  res.json({
    success: true,
    key,
    accounts: db[key].accounts || [],
    expiresAt: db[key].expiresAt
  });
});

// ===== API: Save user accounts =====
app.post('/api/save-accounts', (req, res) => {
  const { key, accounts } = req.body;
  if (!key) return res.status(400).json({ error: 'Key required' });
  const db = readDB();
  if (!db[key]) return res.status(401).json({ error: 'Invalid key' });
  db[key].accounts = accounts;
  writeDB(db);
  res.json({ success: true });
});

// ===== API: Admin users list =====
app.get('/api/admin/users', (req, res) => {
  const { masterKey } = req.query;
  if (masterKey !== ADMIN_MASTER_KEY) return res.status(403).json({ error: 'Unauthorized' });
  const db = readDB();
  const users = Object.values(db).map(u => ({
    key: u.key,
    ip: u.ip || 'never logged in',
    fingerprint: u.fingerprint || 'N/A',
    lastLogin: u.lastLogin || 'never',
    accountsCount: (u.accounts || []).length,
    accounts: u.accounts || [],
    expiresAt: u.expiresAt
  }));
  res.json(users);
});

// ===== API: Delete user =====
app.delete('/api/admin/user', (req, res) => {
  const { masterKey, key } = req.query;
  if (masterKey !== ADMIN_MASTER_KEY) return res.status(403).json({ error: 'Unauthorized' });
  if (!key) return res.status(400).json({ error: 'Key required' });
  const db = readDB();
  if (!db[key]) return res.status(404).json({ error: 'User not found' });
  delete db[key];
  writeDB(db);
  res.json({ success: true });
});

// ============================================================
// ===== MIDDLEWARE: Validate key on protected routes =====
// ============================================================
function validateKey(req, res, next) {
  const key = req.headers['x-auth-key'] || req.body.key || req.query.key;
  if (!key) {
    return res.status(401).json({ code: -1, msg: 'No key provided' });
  }
  const db = readDB();
  if (!db[key]) {
    return res.status(401).json({ code: -1, msg: 'Invalid key' });
  }
  if (db[key].expiresAt && db[key].expiresAt < Date.now()) {
    return res.status(401).json({ code: -1, msg: 'Key expired' });
  }
  req.userKey = key;
  next();
}

// ============================================================
// ===== YAARWIN APIs =====
// ============================================================

function normalizePhone(phone) {
  let cleaned = String(phone).replace(/[\s\-+]/g, '');
  if (cleaned.startsWith('0')) cleaned = cleaned.substring(1);
  if (/^\d{10}$/.test(cleaned)) cleaned = '91' + cleaned;
  return cleaned;
}

function generateSignature(payload) {
  const filtered = {};
  for (const key in payload) {
    const val = payload[key];
    if (val !== null && val !== undefined && val !== '') filtered[key] = val;
  }
  const sorted = Object.keys(filtered).sort().reduce((o, k) => { o[k] = filtered[k]; return o; }, {});
  const raw = JSON.stringify(sorted);
  return crypto.createHash('md5').update(raw).digest('hex').toUpperCase();
}

app.post('/api/login', validateKey, async (req, res) => {
  try {
    let { username, pwd } = req.body;
    if (!username || !pwd) return res.status(400).json({ code: -1, msg: 'Missing' });
    username = normalizePhone(username);
    const ts = Math.floor(Date.now() / 1000);
    const rand = crypto.createHash('md5').update(String(Math.floor(Math.random() * 1000000))).digest('hex');
    const device = crypto.createHash('md5').update(`auto_${Math.floor(Math.random() * 900000) + 100000}_${ts}`).digest('hex');
    const base = {
      username,
      pwd,
      phonetype: 0,
      logintype: 'mobile',
      packId: '',
      deviceId: device,
      pixelId: '',
      fbcId: '',
      fbc: '',
      fbp: '',
      adId: '',
      language: 0,
      random: rand
    };
    const sig = generateSignature(base);
    const final = { ...base, signature: sig, timestamp: ts };
    const resp = await fetch(`${YARWIN_BASE}/Login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Project': PROJECT,
        'User-Agent': 'Mozilla/5.0'
      },
      body: JSON.stringify(final)
    });
    const data = await resp.json();
    res.json(data);
  } catch(e) {
    res.status(500).json({ code: -1, msg: e.message });
  }
});

app.post('/api/login/batch', validateKey, async (req, res) => {
  const { accounts } = req.body;
  if (!accounts || !Array.isArray(accounts)) {
    return res.status(400).json({ code: -1, msg: 'Missing accounts array' });
  }
  const results = [];
  for (const acc of accounts) {
    try {
      const loginRes = await fetch(`${req.protocol}://${req.get('host')}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: acc.username, pwd: acc.pwd })
      });
      const data = await loginRes.json();
      results.push({
        username: acc.username,
        success: data.code === 0,
        token: data.data?.token || null,
        msg: data.msg || (data.code === 0 ? 'OK' : 'Login failed')
      });
    } catch(e) {
      results.push({ username: acc.username, success: false, msg: e.message });
    }
  }
  res.json(results);
});

app.post('/api/redeem', validateKey, async (req, res) => {
  try {
    const { token, giftCode, accountUsername } = req.body;
    if (!token || !giftCode) return res.status(400).json({ code: -1, msg: 'Missing token or code' });
    const ts = Math.floor(Date.now() / 1000);
    const rand = crypto.createHash('md5').update(String(Math.floor(Math.random() * 1000000))).digest('hex');
    const base = { giftCode, language: 0, random: rand };
    const sig = generateSignature(base);
    const final = { ...base, signature: sig, timestamp: ts };
    const resp = await fetch(`${YARWIN_BASE}/ConversionRedpage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Project': PROJECT,
        'User-Agent': 'Mozilla/5.0'
      },
      body: JSON.stringify(final)
    });
    const data = await resp.json();
    res.json(data);
  } catch(e) {
    res.status(500).json({ code: -1, msg: e.message });
  }
});

app.post('/api/register', validateKey, async (req, res) => {
  try {
    let { username, pwd, inviteCode } = req.body;
    if (!username || !pwd) return res.status(400).json({ code: -1, msg: 'Missing' });
    username = normalizePhone(username);
    const ts = Math.floor(Date.now() / 1000);
    const rand = crypto.createHash('md5').update(String(Math.floor(Math.random() * 1000000))).digest('hex');
    const device = crypto.createHash('md5').update(`auto_${Math.floor(Math.random() * 900000) + 100000}_${ts}`).digest('hex');
    const base = {
      username,
      pwd,
      phonetype: 0,
      registerType: 'mobile',
      deviceId: device,
      domainurl: 'yaarwin.xyz',
      invitecode: inviteCode || '378832018903',
      language: 0,
      packId: '',
      pixelId: '',
      random: rand,
      smsvcode: '',
      track: '',
      captchaId: '',
      adId: ''
    };
    const sig = generateSignature(base);
    const final = { ...base, signature: sig, timestamp: ts };
    const resp = await fetch(`${YARWIN_BASE}/Register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Project': PROJECT,
        'User-Agent': 'Mozilla/5.0'
      },
      body: JSON.stringify(final)
    });
    const data = await resp.json();
    res.json(data);
  } catch(e) {
    res.status(500).json({ code: -1, msg: e.message });
  }
});

// ============================================================
// ===== BOT STATE & ENDPOINTS =====
// ============================================================

const botState = {
  accounts: [],
  channels: [],
  isMonitoring: false,
  logs: [],
  allocations: {},
  telegramApiId: '',
  telegramApiHash: '',
  telegramSession: ''
};

app.get('/api/bot-accounts', (req, res) => {
  res.json({ accounts: botState.accounts });
});

app.post('/api/bot-accounts', (req, res) => {
  const { accounts } = req.body;
  if (!accounts || !Array.isArray(accounts)) {
    return res.status(400).json({ error: 'accounts array required' });
  }
  botState.accounts = accounts;
  res.json({ success: true, count: accounts.length });
});

app.get('/api/bot-channels', (req, res) => {
  res.json({ channels: botState.channels });
});

app.post('/api/bot-channels', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });
  const exists = botState.channels.find(c => c.username === username.toLowerCase());
  if (exists) return res.json({ success: false, msg: 'Already added' });
  botState.channels.push({
    id: Date.now(),
    username: username.toLowerCase().replace('@', ''),
    title: username,
    addedAt: new Date().toISOString()
  });
  res.json({ success: true, channels: botState.channels });
});

app.delete('/api/bot-channels/:id', (req, res) => {
  const id = parseInt(req.params.id);
  botState.channels = botState.channels.filter(c => c.id !== id);
  res.json({ success: true, channels: botState.channels });
});

app.get('/api/bot-allocations', (req, res) => {
  res.json({ allocations: botState.allocations });
});

app.post('/api/bot-allocations', (req, res) => {
  const { allocations } = req.body;
  if (!allocations || typeof allocations !== 'object') {
    return res.status(400).json({ error: 'allocations object required' });
  }
  botState.allocations = allocations;
  res.json({ success: true, allocations: botState.allocations });
});

app.get('/api/telegram-credentials', (req, res) => {
  res.json({
    apiId: botState.telegramApiId || '',
    apiHash: botState.telegramApiHash || '',
    session: botState.telegramSession || ''
  });
});

app.post('/api/telegram-credentials', (req, res) => {
  const { apiId, apiHash, session } = req.body;
  if (!apiId || !apiHash) {
    return res.status(400).json({ error: 'API ID and Hash are required' });
  }
  botState.telegramApiId = apiId;
  botState.telegramApiHash = apiHash;
  botState.telegramSession = session || '';
  res.json({ success: true });
});

app.get('/api/bot-status', (req, res) => {
  res.json({
    monitoring: botState.isMonitoring,
    channels: botState.channels,
    accounts: botState.accounts.length,
    allocations: Object.keys(botState.allocations).length
  });
});

app.post('/api/bot-toggle', (req, res) => {
  botState.isMonitoring = !botState.isMonitoring;
  res.json({ monitoring: botState.isMonitoring });
});

app.post('/api/bot-logs', (req, res) => {
  const { log } = req.body;
  if (!log) return res.status(400).json({ error: 'log required' });
  botState.logs.push({
    time: log.time || new Date().toISOString(),
    msg: log.msg || '',
    type: log.type || 'info'
  });
  if (botState.logs.length > 500) botState.logs.shift();
  res.json({ success: true });
});

app.get('/api/bot-logs', (req, res) => {
  res.json({ logs: botState.logs });
});

// ============================================================
// ===== Admin Dashboard =====
// ============================================================
app.get('/admin', (req, res) => {
  const { key } = req.query;
  if (key !== ADMIN_MASTER_KEY) {
    res.send(`
      <html><body style="background:#111;color:#fff;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;">
        <form method="GET" action="/admin">
          <h2>Admin Login</h2>
          <input type="password" name="key" placeholder="Enter master key" style="padding:10px;width:300px;"/>
          <button type="submit" style="padding:10px 20px;">Login</button>
        </form>
      </body></html>
    `);
    return;
  }
  res.send(`
    <html>
      <head><title>Admin Panel</title><style>body{background:#1a1a2e;color:#eee;font-family:sans-serif;padding:20px;}table{width:100%;border-collapse:collapse;margin-top:20px;}th,td{border:1px solid #444;padding:8px;text-align:left;}th{background:#333;}button{background:#d32f2f;color:#fff;border:none;padding:4px 12px;cursor:pointer;border-radius:4px;}button:hover{background:#b71c1c;}</style></head>
      <body>
        <h1>👥 Users</h1>
        <div id="users"></div>
        <script>
          async function loadUsers() {
            const res = await fetch('/api/admin/users?masterKey=${ADMIN_MASTER_KEY}');
            const users = await res.json();
            let html = '<table><tr><th>Key</th><th>IP</th><th>Fingerprint</th><th>Last Login</th><th>Accounts</th><th>Expires</th><th>Action</th></tr>';
            users.forEach(u => {
              const expiry = u.expiresAt ? new Date(u.expiresAt).toLocaleString() : 'Unlimited';
              html += \`<tr>
                <td><code>\${u.key}</code></td>
                <td>\${u.ip}</td>
                <td>\${u.fingerprint}</td>
                <td>\${u.lastLogin}</td>
                <td>\${u.accountsCount}</td>
                <td>\${expiry}</td>
                <td><button onclick="deleteUser('\${u.key}')">Delete</button></td>
              </tr>\`;
            });
            html += '</table>';
            document.getElementById('users').innerHTML = html;
          }
          async function deleteUser(key) {
            if(!confirm('Delete user '+key+'?')) return;
            await fetch('/api/admin/user?masterKey=${ADMIN_MASTER_KEY}&key='+key, {method:'DELETE'});
            loadUsers();
          }
          loadUsers();
        </script>
      </body>
    </html>
  `);
});

// ============================================================
// ===== Serve index.html =====
// ============================================================
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🔑 Admin dashboard: /admin?key=${ADMIN_MASTER_KEY}`);
});