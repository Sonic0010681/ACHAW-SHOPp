const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

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
  console.error("FATAL: Firebase service account configuration missing! Place 'firebase-credentials.json' in root or set 'FIREBASE_SERVICE_ACCOUNT' env variable.");
  process.exit(1);
}

// Initialize Firebase Admin safely
if (admin.getApps().length === 0) {
  admin.initializeApp({
    credential: admin.cert(serviceAccount)
  });
}

const { getFirestore } = require('firebase-admin/firestore');
const db = getFirestore();

// Keep local in-memory cache synchronized for performance
let cache = {
  products: [],
  keys: [],
  settings: {
    adminPassword: "admin",
    adminKey: "AchW>#31>!!...1_!*34",
    adminTotpSecret: "JBSWY3DPEHPK3PXP"
  }
};

// Watch Firebase collections for real-time sync
db.collection('products').onSnapshot(snapshot => {
  cache.products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  console.log(`[FIREBASE] Synced ${cache.products.length} products.`);
}, err => console.error(err));

db.collectionGroup('keys').onSnapshot(snapshot => {
  cache.keys = snapshot.docs.map(doc => doc.data());
  console.log(`[FIREBASE] Synced ${cache.keys.length} keys.`);
}, err => console.error(err));

db.collection('settings').doc('config').onSnapshot(doc => {
  if (doc.exists) {
    cache.settings = doc.data();
    console.log(`[FIREBASE] Synced configuration settings.`);
  } else {
    // Seed initial settings in Firebase if empty
    db.collection('settings').doc('config').set(cache.settings);
  }
}, err => console.error(err));

module.exports = {
  getProducts: () => cache.products,
  getProduct: (id) => cache.products.find(p => p.id === id),
  saveProduct: async (product) => {
    // Generate id if new
    const prodId = product.id || 'prod-' + Date.now();
    const data = { ...product, id: prodId };
    await db.collection('products').doc(prodId).set(data);
    return data;
  },
  deleteProduct: async (id) => {
    await db.collection('products').doc(id).delete();
    // Cascade delete associated keys from subcollection
    const batch = db.batch();
    const keysSnapshot = await db.collection('products').doc(id).collection('keys').get();
    keysSnapshot.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  },

  getKeys: () => cache.keys,
  getKey: (keyStr) => cache.keys.find(k => k.key.toUpperCase() === keyStr.toUpperCase()),
  saveKeys: async (keysArray) => {
    const batch = db.batch();
    
    // Clear old keys first (if empty array represents clearing)
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
    const keyObj = cache.keys.find(k => k.key.toUpperCase() === keyStr.toUpperCase());
    if (keyObj) {
      await db.collection('products').doc(keyObj.productId).collection('keys').doc(keyStr.toUpperCase()).delete();
    }
  },

  getSettings: () => cache.settings,
  saveSettings: async (settings) => {
    await db.collection('settings').doc('config').set(settings);
    return settings;
  }
};
