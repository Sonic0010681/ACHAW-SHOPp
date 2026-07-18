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
  // IMPORTANT: Never use process.exit() inside a Vercel serverless function.
  // It kills the whole invocation with no HTTP response, which is what causes
  // the frontend to hang on "loading..." forever. Throwing lets Express/Vercel
  // turn this into a proper 500 response instead.
  throw new Error(
    "FATAL: Firebase service account configuration missing! " +
    "Set the FIREBASE_SERVICE_ACCOUNT environment variable in your Vercel project " +
    "(Settings -> Environment Variables) with the full JSON content of your " +
    "service account key on a single line."
  );
}

// Initialize Firebase Admin safely
if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.cert(serviceAccount)
  });
}

const { getFirestore } = require('firebase-admin/firestore');
const db = getFirestore();

// Generate a strong, unpredictable default admin key + TOTP secret.
// These are ONLY used the very first time the app runs (when Firestore has no
// 'settings/config' doc yet). After that, whatever is stored in Firestore wins.
// Hardcoding a fixed key/secret here (as the old code did) means anyone who
// ever saw this source file could log in as admin and generate valid 2FA
// codes forever - so we generate fresh random values on first boot instead.
function generateSecureAdminKey() {
  return 'ACHAW-ADMIN-' + crypto.randomBytes(12).toString('hex').toUpperCase();
}

// Keep local in-memory cache synchronized for performance
let cache = {
  products: [],
  keys: [],
  settings: {
    adminKey: generateSecureAdminKey(),
    adminTotpSecret: authenticator.generateSecret()
  }
};

// Watch Firebase collections for real-time sync
db.collection('products').onSnapshot(snapshot => {
  cache.products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  console.log(`[FIREBASE] Synced ${cache.products.length} products.`);
}, err => console.error('[FIREBASE] products listener error:', err));

db.collectionGroup('keys').onSnapshot(snapshot => {
  cache.keys = snapshot.docs.map(doc => doc.data());
  console.log(`[FIREBASE] Synced ${cache.keys.length} keys.`);
}, err => console.error('[FIREBASE] keys listener error:', err));

db.collection('settings').doc('config').onSnapshot(doc => {
  if (doc.exists) {
    cache.settings = doc.data();
    console.log(`[FIREBASE] Synced configuration settings.`);
  } else {
    // Seed initial settings in Firebase if empty (first-ever boot only)
    db.collection('settings').doc('config').set(cache.settings)
      .then(() => {
        console.log('================ İLK KURULUM ================');
        console.log('Admin Key   :', cache.settings.adminKey);
        console.log('TOTP Secret :', cache.settings.adminTotpSecret);
        console.log('Bu değerleri şimdi bir yere kopyala - bir daha bu şekilde gösterilmeyecek.');
        console.log('Admin panelinden istediğin zaman değiştirebilirsin.');
        console.log('===============================================');
      })
      .catch(err => console.error('[FIREBASE] failed to seed settings:', err));
  }
}, err => console.error('[FIREBASE] settings listener error:', err));

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
