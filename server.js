const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const axios = require('axios');
const QRCode = require('qrcode');
const pino = require('pino');

const app = express();
app.use(express.json());

let sock = null;
let qrCodeData = null;
let isConnected = false;

const N8N_WEBHOOK = process.env.N8N_WEBHOOK_URL || 'https://your-n8n.com/webhook/makaan-babu-wa';

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

  sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    connectTimeoutMs: 120000,
    keepAliveIntervalMs: 30000,
    retryRequestDelayMs: 2000,
    browser: ['Makaan Babu', 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCodeData = await QRCode.toDataURL(qr);
      isConnected = false;
      console.log('QR Code ready');
    }

    if (connection === 'close') {
      isConnected = false;
      const shouldReconnect = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
        : true;

      if (shouldReconnect) {
        console.log('Reconnecting...');
        setTimeout(startWhatsApp, 10000);
      }
    }

    if (connection === 'open') {
      isConnected = true;
      qrCodeData = null;
      console.log('WhatsApp Connected!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (msg.key.remoteJid.includes('@g.us')) continue;

      const chatId = msg.key.remoteJid;
      const text = msg.message?.conversation ||
                   msg.message?.extendedTextMessage?.text || '';
      const senderName = msg.pushName || 'User';

      if (!text) continue;

      try {
        await axios.post(N8N_WEBHOOK, {
          chatId,
          message: text,
          senderName,
          timestamp: new Date().toISOString()
        });
      } catch(e) {
        console.log('n8n error:', e.message);
      }
    }
  });
}

app.get('/qr', (req, res) => {
  if (isConnected) {
    return res.send(`<html><body style="text-align:center;font-family:Arial;padding:50px"><h1 style="color:green">WhatsApp Connected!</h1></body></html>`);
  }
  if (!qrCodeData) {
    return res.send(`<html><body style="text-align:center;font-family:Arial;padding:50px"><h2>Generating QR Code...</h2><p>Refresh in 10 seconds</p><script>setTimeout(()=>location.reload(),5000)</script></body></html>`);
  }
  res.send(`<html><body style="text-align:center;font-family:Arial;padding:20px"><h2>Scan QR Code</h2><p>WhatsApp > Linked Devices > Link a Device</p><img src="${qrCodeData}" style="width:300px;height:300px"/><p style="color:red">Scan within 60 seconds!</p><script>setTimeout(()=>location.reload(),30000)</script></body></html>`);
});

app.post('/send', async (req, res) => {
  try {
    const { chatId, message } = req.body;
    if (!isConnected || !sock) {
      return res.status(500).json({ error: 'WhatsApp not connected' });
    }
    const delay = Math.floor(Math.random() * 2000) + 2000;
    await new Promise(r => setTimeout(r, delay));
    await sock.sendPresenceUpdate('composing', chatId);
    await new Promise(r => setTimeout(r, 1500));
    await sock.sendPresenceUpdate('paused', chatId);
    await sock.sendMessage(chatId, { text: message });
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (req, res) => {
  res.json({
    status: isConnected ? 'Connected' : 'Disconnected',
    service: 'Makaan Babu WhatsApp Server'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startWhatsApp();
});
