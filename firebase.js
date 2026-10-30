
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";

// =====================================
// DARJEELINGHOST V1 - EASYVARA FIREBASE
// =====================================

const firebaseConfig = {
  apiKey: "AIzaSyD1JZNg8nu_YvDFgJHRSkCqetQIH_k3jyo",
  authDomain: "easyvara.firebaseapp.com",
  projectId: "easyvara",
  storageBucket: "easyvara.firebasestorage.app",
  messagingSenderId: "992724937897",
  appId: "1:992724937897:web:4d7166d7690d34a1b90db8",
  measurementId: "G-FRW5QJTF9X"
};

// =====================================
// INITIALIZE FIREBASE
// =====================================

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);

// =====================================
// AUTHENTICATION FUNCTIONS
// =====================================

async function registerUser(email, password, displayName = "") {
  const result = await createUserWithEmailAndPassword(
    auth,
    email.trim().toLowerCase(),
    password
  );

  if (displayName.trim()) {
    await updateProfile(result.user, {
      displayName: displayName.trim()
    });
  }

  return result.user;
}

async function loginUser(email, password) {
  const result = await signInWithEmailAndPassword(
    auth,
    email.trim().toLowerCase(),
    password
  );

  return result.user;
}

async function logoutUser() {
  return await signOut(auth);
}

function observeAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

// =====================================
// USER PROFILE FUNCTIONS
// =====================================

async function getUserProfile(uid) {
  const profileRef = doc(db, "users", uid);
  const profileSnap = await getDoc(profileRef);

  return profileSnap.exists() ? profileSnap.data() : null;
}

async function createUserProfile(uid, profileData) {
  const profileRef = doc(db, "users", uid);

  await setDoc(profileRef, {
    ...profileData,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return true;
}

async function updateUserProfile(uid, profileData) {
  const profileRef = doc(db, "users", uid);

  await updateDoc(profileRef, {
    ...profileData,
    updatedAt: serverTimestamp()
  });

  return true;
}

// =====================================
// EXPORT FUNCTIONS
// =====================================

export {
  app,
  auth,
  db,
  registerUser,
  loginUser,
  logoutUser,
  observeAuth,
  getUserProfile,
  createUserProfile,
  updateUserProfile
};

// =====================================
// GLOBAL ACCESS
// =====================================

window.DarjFirebase = {
  app,
  auth,
  db,
  registerUser,
  loginUser,
  logoutUser,
  observeAuth,
  getUserProfile,
  createUserProfile,
  updateUserProfile
};

console.log("DarjeelingHost: Firebase initialized.");
