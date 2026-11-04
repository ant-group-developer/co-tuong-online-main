/**
 * Khởi tạo Firebase (lazy). Chế độ chơi với máy KHÔNG cần Firebase.
 * Frontend không gửi request tới xqchess.com hay bất kỳ backend nào khác ngoài Firebase của bạn.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectDatabaseEmulator, getDatabase, type Database } from 'firebase/database';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';
import { envVar } from './env';

const env = {
  VITE_USE_EMULATORS: envVar('VITE_USE_EMULATORS'),
  VITE_EMULATOR_HOST: envVar('VITE_EMULATOR_HOST'),
  VITE_FIREBASE_API_KEY: envVar('VITE_FIREBASE_API_KEY'),
  VITE_FIREBASE_AUTH_DOMAIN: envVar('VITE_FIREBASE_AUTH_DOMAIN'),
  VITE_FIREBASE_PROJECT_ID: envVar('VITE_FIREBASE_PROJECT_ID'),
  VITE_FIREBASE_DATABASE_URL: envVar('VITE_FIREBASE_DATABASE_URL'),
  VITE_FIREBASE_APP_ID: envVar('VITE_FIREBASE_APP_ID'),
  VITE_FIREBASE_STORAGE_BUCKET: envVar('VITE_FIREBASE_STORAGE_BUCKET'),
  VITE_FIREBASE_MESSAGING_SENDER_ID: envVar('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  VITE_FUNCTIONS_REGION: envVar('VITE_FUNCTIONS_REGION'),
  VITE_APPCHECK_RECAPTCHA_ENTERPRISE_KEY: envVar('VITE_APPCHECK_RECAPTCHA_ENTERPRISE_KEY'),
};
export const USE_EMULATORS = env.VITE_USE_EMULATORS === 'true';
const EMU_HOST = env.VITE_EMULATOR_HOST || '127.0.0.1';
const PROJECT_ID = env.VITE_FIREBASE_PROJECT_ID || (USE_EMULATORS ? 'demo-xiangqi' : '');
export const FUNCTIONS_REGION = env.VITE_FUNCTIONS_REGION || 'asia-southeast1';

export const firebaseConfigured = USE_EMULATORS || Boolean(env.VITE_FIREBASE_API_KEY && PROJECT_ID && env.VITE_FIREBASE_DATABASE_URL);

export interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  db: Database;
  fs: Firestore;
  fns: Functions;
}

let services: FirebaseServices | null = null;

export function fb(): FirebaseServices {
  if (services) return services;
  if (!firebaseConfigured) throw new Error('FIREBASE_NOT_CONFIGURED');
  const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY || 'demo-api-key',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || `${PROJECT_ID}.firebaseapp.com`,
    projectId: PROJECT_ID,
    // Emulator: namespace mặc định "<project>-default-rtdb" giống Functions emulator.
    databaseURL: env.VITE_FIREBASE_DATABASE_URL || `https://${PROJECT_ID}-default-rtdb.firebaseio.com`,
    appId: env.VITE_FIREBASE_APP_ID || undefined,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || undefined,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || undefined,
  });
  const auth = getAuth(app);
  const db = getDatabase(app);
  const fs = getFirestore(app);
  const fns = getFunctions(app, FUNCTIONS_REGION);
  if (USE_EMULATORS) {
    connectAuthEmulator(auth, `http://${EMU_HOST}:9099`, { disableWarnings: true });
    connectDatabaseEmulator(db, EMU_HOST, 9000);
    connectFirestoreEmulator(fs, EMU_HOST, 8085);
    connectFunctionsEmulator(fns, EMU_HOST, 5001);
  } else if (env.VITE_APPCHECK_RECAPTCHA_ENTERPRISE_KEY) {
    // App Check bổ sung chống lạm dụng; KHÔNG thay thế auth/luật game.
    void import('firebase/app-check').then(({ initializeAppCheck, ReCaptchaEnterpriseProvider }) => {
      initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(env.VITE_APPCHECK_RECAPTCHA_ENTERPRISE_KEY),
        isTokenAutoRefreshEnabled: true,
      });
    });
  }
  services = { app, auth, db, fs, fns };
  if (import.meta.env.DEV) (window as unknown as { __xqfb?: FirebaseServices }).__xqfb = services;
  return services;
}
