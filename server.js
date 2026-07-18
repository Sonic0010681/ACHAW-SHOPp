const express = require('express');
const requestIp = require('request-ip');
const { authenticator } = require('otplib');
const path = require('path');
const db = require('./database');
const { getLatestOpenAICode } = require('./emailReader');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(requestIp.mw());

// HTTP Security Headers Shield (OWASP standard compliance)
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self' https: data: 'unsafe-inline' 'unsafe-eval';");
  next();
});

// Brute Force and Rate Limiter Shield
const failedAttempts = new Map(); // IP -> { count, lockUntil }

function bruteForceShield(req, res, next) {
  const clientIp = req.clientIp || req.ip;
  const now = Date.now();
  
  if (failedAttempts.has(clientIp)) {
    const record = failedAttempts.get(clientIp);
    if (record.lockUntil && now < record.lockUntil) {
      const remainingMinutes = Math.ceil((record.lockUntil - now) / 60000);
      return res.status(429).json({ error: `Çok fazla başarısız deneme! Cihazınız ${remainingMinutes} dakika süreyle bloke edildi.` });
    }
  }
  next();
}

function recordFailedAttempt(clientIp) {
  const now = Date.now();
  if (!failedAttempts.has(clientIp)) {
    failedAttempts.set(clientIp, { count: 1, lockUntil: null });
  } else {
    const record = failedAttempts.get(clientIp);
    record.count++;
    if (record.count >= 5) {
      record.lockUntil = now + 15 * 60 * 1000; // Lock for 15 minutes after 5 fails
      console.log(`[SECURITY ALERT] IP Locked: ${clientIp} due to brute force risk.`);
    }
  }
}

function clearFailedAttempts(clientIp) {
  failedAttempts.delete(clientIp);
}

// Global SQL/Command Injection & XSS Prevention Shield
function sqlInjectionShield(req, res, next) {
  const hasInjection = (val) => {
    if (typeof val === 'string') {
      // 1. URL Decode recursively to resolve URL-encoded bypasses (%55%4e%49... -> UNION)
      let decoded = val;
      try {
        let prev;
        do {
          prev = decoded;
          decoded = decodeURIComponent(decoded);
        } while (decoded !== prev);
      } catch (e) {
        // Ignore decoding errors
      }

      const lowerVal = decoded.toLowerCase();

      // 2. Block standard SQL Injection syntax, operators, comments and tautology signatures
      if (lowerVal.includes("'") || 
          lowerVal.includes('"') || 
          lowerVal.includes(';') || 
          lowerVal.includes('--') || 
          lowerVal.includes('/*') || 
          lowerVal.includes('*/') || 
          lowerVal.includes('xp_') || 
          lowerVal.includes('waitfor') || 
          lowerVal.includes('delay') ||
          /\b(select|union|insert|update|delete|drop|alter|create|truncate|having|limit|into|load_file|outfile|exec|execute|sleep)\b/i.test(lowerVal)) {
        return true;
      }

      // 3. Squash whitespace, tabs, pluses, dashes, comments to detect spaced bypasses (e.g. "u n i o n", "u+n+i+o+n")
      const squashed = lowerVal
        .replace(/\/\*.*?\*\//g, '')  // remove comment blocks
        .replace(/[\s\+\-_#\*\/]/g, ''); // remove spaces, tabs, symbols
      
      const squashedBanned = ['union', 'select', 'insert', 'update', 'delete', 'droptable', 'dropdatabase', 'truncate', 'sleep', 'execute', 'loadfile', 'outfile'];
      for (const banned of squashedBanned) {
        if (squashed.includes(banned)) {
          return true;
        }
      }

      // 4. Block tautology/comparison injections (like "1=1", "a=a", etc.)
      if (/(\w+)\s*=\s*\1/.test(lowerVal)) {
        return true;
      }
    } else if (typeof val === 'object' && val !== null) {
      for (const k in val) {
        // Skip base64 image data payload to prevent false positives on image uploads
        if (k === 'image' && typeof val[k] === 'string' && val[k].startsWith('data:image/')) {
          continue;
        }
        if (hasInjection(val[k])) return true;
      }
    }
    return false;
  };

  if (hasInjection(req.body) || hasInjection(req.query) || hasInjection(req.params)) {
    return res.status(400).json({ error: 'Güvenlik Protokolü: Şüpheli karakter veya SQL komutu tespit edildi!' });
  }
  next();
}

app.use(sqlInjectionShield);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});



// Helper to sanitize product data (omit totpSecret and IMAP configuration)
function sanitizeProduct(product) {
  if (!product) return null;
  const { totpSecret, imapHost, imapPort, imapUser, imapPassword, ...sanitized } = product;
  return {
    ...sanitized,
    has2Fa: !!totpSecret,
    hasImap: !!(imapHost && imapUser && imapPassword)
  };
}

// Public Endpoint: Get products catalog and active announcement
app.get('/api/products', (req, res) => {
  const products = db.getProducts();
  const sanitized = products.filter(p => p.isActive !== false).map(p => sanitizeProduct(p));
  const settings = db.getSettings();
  res.json({
    products: sanitized,
    announcementText: settings.announcementText || '',
    announcementId: settings.announcementId || ''
  });
});


// User Endpoint: Key validation and activation with brute force shielding
app.post('/api/verify-key', bruteForceShield, async (req, res) => {
  const { key: keyStr } = req.body;
  const clientIp = req.clientIp || req.ip;

  if (!keyStr) {
    return res.status(400).json({ error: 'Lütfen bir anahtar girin!' });
  }

  // Safe input format check supporting custom characters
  const keyRegex = /^[a-zA-Z0-9\-_>#!.*_]+$/;
  if (!keyRegex.test(keyStr)) {
    return res.status(400).json({ error: 'Geçersiz anahtar formatı!' });
  }

  const settings = db.getSettings();
  if (settings.adminKey && keyStr.toUpperCase() === settings.adminKey.toUpperCase()) {
    // Admin key matched! Verify 2FA OTP
    const { code } = req.body;
    if (!code) {
      return res.json({ require2Fa: true });
    }

    const adminTotpSecret = settings.adminTotpSecret || 'JBSWY3DPEHPK3PXP';
    const isValidTotp = authenticator.verify({ token: code, secret: adminTotpSecret });
    if (!isValidTotp) {
      recordFailedAttempt(clientIp);
      return res.status(403).json({ error: 'Google Authenticator kodu hatalı!' });
    }

    // Bind Admin IP to lock to this device (Single authorized device)
    settings.adminIp = clientIp;
    await db.saveSettings(settings);

    return res.json({
      isAdmin: true,
      adminKey: settings.adminKey
    });
  }

  const keyObj = db.getKey(keyStr);
  if (!keyObj) {
    recordFailedAttempt(clientIp);
    return res.status(404).json({ error: 'Geçersiz anahtar! Lütfen kontrol edin.' });
  }

  const product = db.getProduct(keyObj.productId);
  if (!product) {
    return res.status(404).json({ error: 'Bu anahtara bağlı bir ürün bulunamadı!' });
  }

  // Activation check: One-time activation only
  if (keyObj.isUsed) {
    return res.status(403).json({ 
      error: 'BU KEY ZATEN KULLANILMIŞ!'
    });
  }

  // First use: Bind IP and mark as used
  keyObj.isUsed = true;
  keyObj.usedAt = new Date().toISOString();
  keyObj.boundIp = clientIp;
  await db.saveKey(keyObj);

  const remainingRequests = Math.max(0, 3 - (keyObj.codeRequestCount || 0));

  clearFailedAttempts(clientIp);

  res.json({
    message: 'Anahtar başarıyla doğrulandı.',
    product: sanitizeProduct(product),
    boundIp: keyObj.boundIp,
    remainingRequests
  });
});

// User Endpoint: Get dynamic 2FA code
app.post('/api/get-otp', async (req, res) => {
  const { key: keyStr } = req.body;
  const clientIp = req.clientIp || req.ip;

  if (!keyStr) {
    return res.status(400).json({ error: 'Anahtar bilgisi eksik!' });
  }

  const keyObj = db.getKey(keyStr);
  if (!keyObj) {
    return res.status(404).json({ error: 'Geçersiz anahtar!' });
  }

  if (!keyObj.isUsed || keyObj.boundIp !== clientIp) {
    return res.status(403).json({ error: 'Erişim reddedildi. IP eşleşmiyor veya anahtar aktif edilmemiş.' });
  }

  const currentCount = keyObj.codeRequestCount || 0;
  if (currentCount >= 3) {
    return res.status(403).json({ error: 'Giriş kodu alma hakkınız dolmuştur! (Maksimum 3 kez kod alabilirsiniz)' });
  }

  const product = db.getProduct(keyObj.productId);
  if (!product || !product.totpSecret) {
    return res.status(400).json({ error: 'Bu ürün için 2FA kodu tanımlanmamış!' });
  }

  try {
    const token = authenticator.generate(product.totpSecret.replace(/\s+/g, ''));
    const timeRemaining = authenticator.timeRemaining();
    
    // Increment code request count
    keyObj.codeRequestCount = currentCount + 1;
    await db.saveKey(keyObj);

    res.json({ 
      token, 
      timeRemaining,
      remainingRequests: 3 - keyObj.codeRequestCount
    });
  } catch (error) {
    console.error("OTP Generation Error:", error);
    res.status(500).json({ error: '2FA kodu üretilirken bir hata oluştu!' });
  }
});

// User Endpoint: Get verification code from ChatGPT/OpenAI e-mail via IMAP
app.post('/api/get-email-code', async (req, res) => {
  const { key: keyStr } = req.body;
  const clientIp = req.clientIp || req.ip;

  if (!keyStr) {
    return res.status(400).json({ error: 'Anahtar bilgisi eksik!' });
  }

  const keyObj = db.getKey(keyStr);
  if (!keyObj) {
    return res.status(404).json({ error: 'Geçersiz anahtar!' });
  }

  if (!keyObj.isUsed || keyObj.boundIp !== clientIp) {
    return res.status(403).json({ error: 'Erişim reddedildi. IP eşleşmiyor.' });
  }

  const currentCount = keyObj.codeRequestCount || 0;
  if (currentCount >= 3) {
    return res.status(403).json({ error: 'Giriş kodu alma hakkınız dolmuştur! (Maksimum 3 kez kod alabilirsiniz)' });
  }

  const product = db.getProduct(keyObj.productId);
  if (!product || !product.imapHost || !product.imapUser || !product.imapPassword) {
    return res.status(400).json({ error: 'Bu ürün için e-posta kod okuma sistemi tanımlanmamış!' });
  }

  try {
    const result = await getLatestOpenAICode({
      host: product.imapHost,
      port: product.imapPort,
      user: product.imapUser,
      password: product.imapPassword
    });

    if (result) {
      // Increment code request count on successful retrieval
      keyObj.codeRequestCount = currentCount + 1;
      await db.saveKey(keyObj);

      res.json({
        code: result.code,
        subject: result.subject,
        date: result.date,
        remainingRequests: 3 - keyObj.codeRequestCount
      });
    } else {
      res.status(404).json({ error: 'Gelen kutusunda OpenAI doğrulama kodu bulunamadı! Lütfen tekrar deneyin veya e-postanın ulaştığından emin olun.' });
    }
  } catch (error) {
    console.error("IMAP Fetch Error:", error);
    res.status(500).json({ error: 'E-posta sunucusuna bağlanırken hata oluştu: ' + error.message });
  }
});



// Admin auth middleware for endpoints
function adminKeyAuth(req, res, next) {
  const keyHeader = req.headers['x-admin-key'];
  const clientIp = req.clientIp || req.ip;
  const settings = db.getSettings();

  if (!keyHeader || keyHeader.toUpperCase() !== settings.adminKey.toUpperCase()) {
    return res.status(401).json({ error: 'Yetkisiz erişim! Admin anahtarı geçersiz.' });
  }

  // Lock to 1 authorized device only (IP check)
  if (settings.adminIp && settings.adminIp !== clientIp) {
    return res.status(403).json({ error: 'Erişim reddedildi! Sadece yetkilendirilmiş cihaz giriş yapabilir.' });
  }

  next();
}

// Admin APIs protected by admin key
app.get('/api/admin/products', adminKeyAuth, (req, res) => {
  res.json(db.getProducts());
});

app.post('/api/admin/products', adminKeyAuth, async (req, res) => {
  const product = req.body;
  if (!product.name) {
    return res.status(400).json({ error: 'Ürün adı zorunludur!' });
  }
  if (!product.id) {
    product.id = 'prod-' + Date.now();
  }
  const saved = await db.saveProduct(product);
  res.json(saved);
});

app.delete('/api/admin/products/:id', adminKeyAuth, async (req, res) => {
  await db.deleteProduct(req.params.id);
  res.json({ success: true });
});

app.get('/api/admin/keys', adminKeyAuth, (req, res) => {
  const keys = db.getKeys();
  const products = db.getProducts();
  const enrichedKeys = keys.map(k => {
    const p = products.find(prod => prod.id === k.productId);
    return {
      ...k,
      productName: p ? p.name : 'Silinmiş Ürün'
    };
  });
  res.json(enrichedKeys);
});

app.post('/api/admin/keys', adminKeyAuth, async (req, res) => {
  const { productId, quantity, customKey } = req.body;
  if (!productId) {
    return res.status(400).json({ error: 'Lütfen bir ürün seçin!' });
  }

  const qty = parseInt(quantity, 10) || 1;
  if (qty > 1) {
    const generatedKeys = [];
    for (let i = 0; i < qty; i++) {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      const genPart = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      const keyStr = `ACHAW-${genPart()}-${genPart()}-${genPart()}`;
      
      const newKey = {
        key: keyStr,
        productId,
        isUsed: false,
        usedAt: null,
        boundIp: null
      };
      await db.saveKey(newKey);
      generatedKeys.push(newKey);
    }
    return res.json(generatedKeys);
  }

  let keyStr = customKey ? customKey.trim().toUpperCase() : '';
  if (!keyStr) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const genPart = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    keyStr = `ACHAW-${genPart()}-${genPart()}-${genPart()}`;
  }
  if (db.getKey(keyStr)) {
    return res.status(400).json({ error: 'Bu anahtar zaten mevcut!' });
  }
  const newKey = {
    key: keyStr,
    productId,
    isUsed: false,
    usedAt: null,
    boundIp: null
  };
  await db.saveKey(newKey);
  res.json(newKey);
});

app.post('/api/admin/keys/reset-ip', adminKeyAuth, async (req, res) => {
  const { key: keyStr } = req.body;
  const keyObj = db.getKey(keyStr);
  if (!keyObj) {
    return res.status(404).json({ error: 'Anahtar bulunamadı!' });
  }
  keyObj.isUsed = false;
  keyObj.usedAt = null;
  keyObj.boundIp = null;
  keyObj.codeRequestCount = 0; // Reset requests left too!
  await db.saveKey(keyObj);
  res.json({ message: 'IP kilidi sıfırlandı.' });
});

app.delete('/api/admin/keys/:key', adminKeyAuth, async (req, res) => {
  await db.deleteKey(req.params.key);
  res.json({ success: true });
});

app.post('/api/admin/settings', adminKeyAuth, async (req, res) => {
  const { adminKey, adminTotpSecret, announcementText } = req.body;
  const settings = db.getSettings();
  
  if (adminKey) {
    if (adminKey.length < 6) {
      return res.status(400).json({ error: 'Admin anahtarı en az 6 karakter olmalıdır!' });
    }
    settings.adminKey = adminKey;
  }
  
  if (adminTotpSecret) {
    settings.adminTotpSecret = adminTotpSecret;
  }

  if (typeof announcementText !== 'undefined') {
    settings.announcementText = announcementText.trim();
    settings.announcementId = 'ann-' + Date.now();
  }
  
  await db.saveSettings(settings);
  res.json({ message: 'Ayarlar güncellendi.' });
});

app.post('/api/admin/keys-clear-all', adminKeyAuth, async (req, res) => {
  const { code } = req.body;
  const settings = db.getSettings();
  if (!code || !authenticator.check(code, settings.adminTotpSecret)) {
    return res.status(400).json({ error: '2FA doğrulama kodu geçersiz!' });
  }
  await db.saveKeys([]);
  res.json({ success: true, message: 'Tüm anahtarlar başarıyla silindi.' });
});

// Start Server
if (process.env.NODE_ENV !== 'production' || require.main === module) {
  app.listen(PORT, () => {
    console.log(`ACHAW SHOP sunucusu http://localhost:${PORT} portunda aktif.`);
  });
}

module.exports = app;
