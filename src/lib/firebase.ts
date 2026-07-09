import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  getDocs, 
  setDoc, 
  doc, 
  getDoc,
  enableIndexedDbPersistence,
  type Firestore
} from 'firebase/firestore';

const firebaseConfig = {
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  firestoreDatabaseId: import.meta.env.VITE_FIRESTORE_DATABASE_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || ''
};

const hasFirebaseClientConfig = Boolean(
  firebaseConfig.projectId &&
  firebaseConfig.appId &&
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain
);

const app = hasFirebaseClientConfig ? initializeApp(firebaseConfig) : null;
export const db: Firestore | null = app
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId || undefined)
  : null;

// Check connections
export async function testConnection() {
  if (!db) {
    console.warn("Firestore connection test skipped: Firebase client configuration is not set.");
    return false;
  }

  try {
    const testDoc = await getDoc(doc(db, 'system', 'status'));
    console.log("Firestore connection test: ok", testDoc.exists());
    return true;
  } catch (error) {
    console.error("Firestore connection failed:", error);
    return false;
  }
}
