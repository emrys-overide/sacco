import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User as FirebaseUser
} from 'firebase/auth';
import type { User } from '../types';

type FirebaseSessionResponse = { user: User };

function firebaseConfig() {
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID
  };
}

export function isFirebaseMemberAuthConfigured(): boolean {
  const config = firebaseConfig();
  return import.meta.env.VITE_FIREBASE_AUTH_ENABLED !== 'false'
    && Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
}

let authInstance: Auth | null = null;

export function getFirebaseAuth(): Auth {
  if (!isFirebaseMemberAuthConfigured()) {
    throw new Error('Secure member sign-in is not configured. Ask the SACCO administrator to configure Firebase Authentication.');
  }
  if (authInstance) return authInstance;
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig());
  authInstance = getAuth(app);
  return authInstance;
}

function verificationSettings() {
  const configuredUrl = String(import.meta.env.VITE_FIREBASE_EMAIL_CONTINUE_URL || '').trim();
  if (!configuredUrl) return undefined;

  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new Error('The secure email return URL is invalid. Ask the SACCO administrator to update Firebase settings.');
  }

  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new Error('The secure email return URL must use HTTPS outside local development.');
  }

  return {
    url: url.toString(),
    handleCodeInApp: false
  };
}

async function readJson(response: Response): Promise<any> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}

async function openFirebaseSession(firebaseUser: FirebaseUser): Promise<{ user: User; token: string }> {
  await firebaseUser.reload();
  if (!firebaseUser.emailVerified) {
    throw new Error('Verify your email from the Firebase link before signing in to the SACCO dashboard.');
  }
  const token = await firebaseUser.getIdToken(true);
  const response = await fetch('/api/auth/firebase/session', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  const data = await readJson(response) as FirebaseSessionResponse;
  return { user: data.user, token };
}

export async function beginFirebaseMemberRegistration(input: { fullName: string; phone: string; email: string; password: string }): Promise<void> {
  const response = await fetch('/api/auth/member-registration', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  await readJson(response);

  const auth = getFirebaseAuth();
  const credential = await signInWithEmailAndPassword(auth, input.email.trim(), input.password);
  try {
    await sendEmailVerification(credential.user, verificationSettings());
  } finally {
    await signOut(auth);
  }
}

export async function signInFirebaseMember(email: string, password: string): Promise<{ user: User; token: string }> {
  const auth = getFirebaseAuth();
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  try {
    return await openFirebaseSession(credential.user);
  } catch (error) {
    if (!credential.user.emailVerified) {
      await sendEmailVerification(credential.user, verificationSettings());
    }
    throw error;
  }
}

export async function resetOfficerPasswordWithVerifiedEmail(input: { email: string; firebasePassword: string; newOfficerPassword: string }): Promise<void> {
  const auth = getFirebaseAuth();
  const credential = await signInWithEmailAndPassword(auth, input.email.trim(), input.firebasePassword);
  try {
    await credential.user.reload();
    if (!credential.user.emailVerified) {
      throw new Error('Verify this email before resetting the officer password.');
    }
    const token = await credential.user.getIdToken(true);
    const response = await fetch('/api/auth/officer-recovery', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ password: input.newOfficerPassword })
    });
    await readJson(response);
  } finally {
    await signOut(auth);
  }
}

export async function sendFirebaseMemberPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(getFirebaseAuth(), email.trim(), verificationSettings());
}

export async function getCurrentFirebaseIdToken(): Promise<string> {
  if (!isFirebaseMemberAuthConfigured()) return '';
  const user = getFirebaseAuth().currentUser;
  return user ? user.getIdToken() : '';
}

export async function signOutFirebaseMember(): Promise<void> {
  if (isFirebaseMemberAuthConfigured() && getFirebaseAuth().currentUser) {
    await signOut(getFirebaseAuth());
  }
}
