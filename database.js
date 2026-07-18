const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { authenticator } = require('otplib');

let serviceAccount;

// 1. Try loading from local credentials file first (ignored by git for security)
const localCredsPath = path.join(__dirname, 'firebase-credentials.json');
if (fs.existsSync(localCredsPath)) {
  serviceAccount = JSON.parse(fs.readFileSync(localCredsPath, 'utf8'));
} else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  // 2. Fallback to Environment Variable for cloud deployments (like Vercel)
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (err) {
    console.error("FIREBASE_SERVICE_ACCOUNT env variable parse failed:", err);
  }
}

if (!serviceAccount) {
  throw new Error(
    "FATAL: Firebase service account configuration missing! " +
    "Set the FIREBASE_SERVICE_ACCOUNT environment variable in your Vercel project " +
    "(Settings -> Environment Variables) with the full JSON content of your " +
    "service account key on a single line."
  );
}

// Initialize Firebase Admin safely (serverless-safe: reuse existing app)
if (admin.getApps().length === 0) {
  admin.initializeApp({
    credential: admin.cert(serviceAccount)
  });
}

const { getFirestore } = require('firebase-admin/firestore');
const db = getFirestore();

function generateSecureAdminKey() {
  return 'ACHAW-ADMIN-' + crypto.randomBytes(12).toString('hex').toUpperCase();
}

const DEFAULT_SETTINGS = {
  adminKey: generateSecureAdminKey(),
  adminTotpSecret: authenticator.generateSecret()
};

// ─────────────────────────────────────────────────────────────────────────────
// SERVERLESS-SAFE DATA ACCESS
// Vercel serverless functions die after each request, so long-lived onSnapshot
// listeners are incompatible. We fetch directly from Firestore on each call.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // ── Products ──────────────────────────────────────────────────────────────
  getProducts: async () => {
    const snap = await db.collection('products').get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  },

  getProduct: async (id) => {
    const doc = await db.collection('products').doc(id).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  },

  saveProduct: async (product) => {
    const prodId = product.id || 'prod-' + Date.now();
    const data = { ...product, id: prodId };
    await db.collection('products').doc(prodId).set(data);
    return data;
  },

  deleteProduct: async (id) => {
    await db.collection('products').doc(id).delete();
    const batch = db.batch();
    const keysSnapshot = await db.collection('products').doc(id).collection('keys').get();
    keysSnapshot.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  },

  // ── Keys ──────────────────────────────────────────────────────────────────
  getKeys: async () => {
    const snap = await db.collectionGroup('keys').get();
    return snap.docs.map(doc => doc.data());
  },

  getKey: async (keyStr) => {
    // CollectionGroup query by key field
    const snap = await db.collectionGroup('keys')
      .where('key', '==', keyStr.toUpperCase())
      .limit(1)
      .get();
    if (!snap.empty) return snap.docs[0].data();
    // Fallback: case-insensitive search (key might be stored as-is)
    const allSnap = await db.collectionGroup('keys').get();
    const found = allSnap.docs.find(d => {
      const k = d.data().key;
      return k && k.toUpperCase() === keyStr.toUpperCase();
    });
    return found ? found.data() : null;
  },

  saveKeys: async (keysArray) => {
    const batch = db.batch();
    if (keysArray.length === 0) {
      const allKeysSnap = await db.collectionGroup('keys').get();
      allKeysSnap.forEach(doc => batch.delete(doc.ref));
    } else {
      keysArray.forEach(k => {
        const docRef = db.collection('products').doc(k.productId).collection('keys').doc(k.key.toUpperCase());
        batch.set(docRef, k);
      });
    }
    await batch.commit();
    return keysArray;
  },

  saveKey: async (keyObj) => {
    const docId = keyObj.key.toUpperCase();
    await db.collection('products').doc(keyObj.productId).collection('keys').doc(docId).set(keyObj);
    return keyObj;
  },

  deleteKey: async (keyStr) => {
    // Find the key across all products
    const allSnap = await db.collectionGroup('keys').get();
    const batch = db.batch();
    allSnap.docs.forEach(doc => {
      const k = doc.data().key;
      if (k && k.toUpperCase() === keyStr.toUpperCase()) {
        batch.delete(doc.ref);
      }
    });
    await batch.commit();
  },

  // ── Settings ──────────────────────────────────────────────────────────────
  getSettings: async () => {
    const doc = await db.collection('settings').doc('config').get();
    if (doc.exists) return doc.data();
    // First boot: seed defaults
    await db.collection('settings').doc('config').set(DEFAULT_SETTINGS);
    console.log('================ İLK KURULUM ================');
    console.log('Admin Key   :', DEFAULT_SETTINGS.adminKey);
    console.log('TOTP Secret :', DEFAULT_SETTINGS.adminTotpSecret);
    console.log('Bu değerleri şimdi bir yere kopyala!');
    console.log('===============================================');
    return DEFAULT_SETTINGS;
  },

  saveSettings: async (settings) => {
    await db.collection('settings').doc('config').set(settings);
    return settings;
  }
};
