import { initializeApp } from 'firebase/app';
import {
  getAuth,
  onIdTokenChanged,
  type Auth
} from 'firebase/auth';

const firebaseConfig = {
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || ''
};

const isFirebaseAuthEnabled = import.meta.env.VITE_FIREBASE_AUTH_ENABLED !== 'false';
const hasFirebaseClientConfig = Boolean(
  firebaseConfig.projectId &&
  firebaseConfig.appId &&
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain
);

const app = hasFirebaseClientConfig ? initializeApp(firebaseConfig) : null;
export const firebaseAuth: Auth | null = app && isFirebaseAuthEnabled ? getAuth(app) : null;

export async function getFirebaseIdToken(forceRefresh = false): Promise<string> {
  const user = firebaseAuth?.currentUser;
  return user ? user.getIdToken(forceRefresh) : '';
}

export { onIdTokenChanged };
