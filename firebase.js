
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

import { getStorage } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-storage.js";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAV9MggoBLbr6IQ6NN6xF5tSRwqy0EL17g",
  authDomain: "studio-5524327838-803a4.firebaseapp.com",
  projectId: "studio-5524327838-803a4",
  storageBucket: "studio-5524327838-803a4.firebasestorage.app",
  messagingSenderId: "4756587991",
  appId: "1:4756587991:web:e5472eb8282e25b05c7792"
};

// Initialize Firebase
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Authentication
export function registerUser(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}

export function loginUser(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function observeAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export function logoutUser() {
  return signOut(auth);
}

// Get driver's application
export async function getDriverApplication(uid) {
  const applicationRef = doc(db, "driverApplications", uid);
  const snapshot = await getDoc(applicationRef);

  return snapshot.exists()
    ? { id: snapshot.id, ...snapshot.data() }
    : null;
}

// Submit driver's application
export async function submitDriverApplication(uid, data) {
  const applicationRef = doc(db, "driverApplications", uid);

  return setDoc(applicationRef, {
    ...data,
    userId: uid,
    status: "submitted",
    verificationStatus: "pending",
    createdAt: serverTimestamp()
  });
}
