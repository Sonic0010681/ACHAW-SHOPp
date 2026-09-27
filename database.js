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

let useLocalDb = false;
let db = null;

if (!serviceAccount) {
  console.warn(
    "[DATABASE WARNING] Firebase service account configuration missing! " +
    "Running with local in-memory database fallback."
  );
  useLocalDb = true;
} else {
  try {
    if (admin.getApps().length === 0) {
      admin.initializeApp({
        credential: admin.cert(serviceAccount)
      });
    }
    const { getFirestore } = require('firebase-admin/firestore');
    db = getFirestore();
  } catch (err) {
    console.error("Firebase init failed, falling back to local DB:", err);
    useLocalDb = true;
  }
}

const DEFAULT_SETTINGS = {
  adminKey: 'ACHAW-ADMIN-1234',
  adminTotpSecret: ''
};

// Local fallback memory stores
const localProducts = new Map();
const localKeys = new Map();
let localSettings = null;

module.exports = {
  // ── Products ──────────────────────────────────────────────────────────────
  getProducts: async () => {
    if (useLocalDb) return Array.from(localProducts.values());
    const snap = await db.collection('products').get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  },

  getProduct: async (id) => {
    if (useLocalDb) return localProducts.get(id) || null;
    const doc = await db.collection('products').doc(id).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  },

  saveProduct: async (product) => {
    const prodId = product.id || 'prod-' + Date.now();
    const data = { ...product, id: prodId };
    if (useLocalDb) {
      localProducts.set(prodId, data);
      return data;
    }
    await db.collection('products').doc(prodId).set(data);
    return data;
  },

  deleteProduct: async (id) => {
    if (useLocalDb) {
      localProducts.delete(id);
      for (const [k, v] of localKeys.entries()) {
        if (v.productId === id) localKeys.delete(k);
      }
      return;
    }
    await db.collection('products').doc(id).delete();
    const batch = db.batch();
    const keysSnapshot = await db.collection('products').doc(id).collection('keys').get();
    keysSnapshot.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  },

  // ── Keys ──────────────────────────────────────────────────────────────────
  getKeys: async () => {
    if (useLocalDb) return Array.from(localKeys.values());
    const snap = await db.collectionGroup('keys').get();
    return snap.docs.map(doc => doc.data());
  },

  getKey: async (keyStr) => {
    if (!keyStr) return null;
    const target = keyStr.trim().toUpperCase();
    if (useLocalDb) {
      return localKeys.get(target) || null;
    }
    try {
      // CollectionGroup query by key field
      const snap = await db.collectionGroup('keys')
        .where('key', '==', target)
        .limit(1)
        .get();
      if (!snap.empty) return snap.docs[0].data();
      // Fallback: search across all keys
      const allSnap = await db.collectionGroup('keys').get();
      const found = allSnap.docs.find(d => {
        const k = d.data().key;
        return k && k.trim().toUpperCase() === target;
      });
      return found ? found.data() : null;
    } catch (err) {
      console.error("Firestore getKey error:", err);
      return null;
    }
  },

  saveKeys: async (keysArray) => {
    if (useLocalDb) {
      if (keysArray.length === 0) {
        localKeys.clear();
      } else {
        keysArray.forEach(k => {
          localKeys.set(k.key.trim().toUpperCase(), k);
        });
      }
      return keysArray;
    }
    const batch = db.batch();
    if (keysArray.length === 0) {
      const allKeysSnap = await db.collectionGroup('keys').get();
      allKeysSnap.forEach(doc => batch.delete(doc.ref));
    } else {
      keysArray.forEach(k => {
        const docRef = db.collection('products').doc(k.productId).collection('keys').doc(k.key.trim().toUpperCase());
        batch.set(docRef, k);
      });
    }
    await batch.commit();
    return keysArray;
  },

  saveKey: async (keyObj) => {
    const docId = keyObj.key.trim().toUpperCase();
    if (useLocalDb) {
      localKeys.set(docId, keyObj);
      return keyObj;
    }
    await db.collection('products').doc(keyObj.productId).collection('keys').doc(docId).set(keyObj);
    return keyObj;
  },

  deleteKey: async (keyStr) => {
    const target = keyStr.trim().toUpperCase();
    if (useLocalDb) {
      localKeys.delete(target);
      return;
    }
    // Find the key across all products
    const allSnap = await db.collectionGroup('keys').get();
    const batch = db.batch();
    allSnap.docs.forEach(doc => {
      const k = doc.data().key;
      if (k && k.trim().toUpperCase() === target) {
        batch.delete(doc.ref);
      }
    });
    await batch.commit();
  },

  // ── Settings ──────────────────────────────────────────────────────────────
  getSettings: async () => {
    if (useLocalDb) {
      if (!localSettings) {
        localSettings = { ...DEFAULT_SETTINGS };
        console.log('================ İLK KURULUM (LOCAL FALLBACK) ================');
        console.log('Admin Key   :', localSettings.adminKey);
        console.log('TOTP Secret :', localSettings.adminTotpSecret);
        console.log('===============================================================');
      }
      return localSettings;
    }
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
    if (useLocalDb) {
      localSettings = { ...settings };
      return localSettings;
    }
    await db.collection('settings').doc('config').set(settings);
    return settings;
  }
};
