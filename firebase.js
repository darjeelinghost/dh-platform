
// ============================================
// DARJEELINGHOST - FIREBASE CONFIGURATION
// ============================================

import {
  initializeApp,
  getApps,
  getApp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

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

import {
  getStorage
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-storage.js";


// ============================================
// FIREBASE PROJECT CONFIGURATION
// ============================================

const firebaseConfig = {
  apiKey: "AIzaSyAV9MggoBLbr6IQ6NN6xF5tSRwqy0EL17g",
  authDomain: "studio-5524327838-803a4.firebaseapp.com",
  projectId: "studio-5524327838-803a4",
  storageBucket: "studio-5524327838-803a4.firebasestorage.app",
  messagingSenderId: "4756587991",
  appId: "1:4756587991:web:e5472eb8282e25b05c7792"
};


// ============================================
// INITIALIZE FIREBASE
// ============================================

const app = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);


// ============================================
// FIREBASE SERVICES
// ============================================

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);


// ============================================
// AUTHENTICATION
// ============================================

// Register a new account
export async function registerUser(email, password) {
  if (!email || !password) {
    throw new Error("Email and password are required.");
  }

  return await createUserWithEmailAndPassword(
    auth,
    email.trim(),
    password
  );
}


// Login existing account
export async function loginUser(email, password) {
  if (!email || !password) {
    throw new Error("Email and password are required.");
  }

  return await signInWithEmailAndPassword(
    auth,
    email.trim(),
    password
  );
}


// Observe login status
export function observeAuth(callback) {
  return onAuthStateChanged(auth, callback);
}


// Logout
export async function logoutUser() {
  return await signOut(auth);
}


// ============================================
// DRIVER APPLICATION
// ============================================

// Get a driver's own application
export async function getDriverApplication(uid) {
  if (!uid || !auth.currentUser || auth.currentUser.uid !== uid) {
    throw new Error("You can only access your own application.");
  }

  const applicationRef = doc(
    db,
    "driverApplications",
    uid
  );

  const snapshot = await getDoc(applicationRef);

  if (!snapshot.exists()) {
    return null;
  }

  return {
    id: snapshot.id,
    ...snapshot.data()
  };
}


// Submit a new driver application
export async function submitDriverApplication(uid, data) {

  if (!auth.currentUser || auth.currentUser.uid !== uid) {
    throw new Error("Authentication required.");
  }

  if (!data) {
    throw new Error("Application information is missing.");
  }

  const requiredFields = [
    "name",
    "email",
    "phone",
    "whatsappNumber",
    "address",
    "licenceNumber",
    "vehicleType",
    "vehicleNumber"
  ];

  for (const field of requiredFields) {
    if (
      typeof data[field] !== "string" ||
      !data[field].trim()
    ) {
      throw new Error("Please complete all required fields.");
    }
  }

  const applicationRef = doc(
    db,
    "driverApplications",
    uid
  );

  // Prevent accidental replacement of an existing application.
  const existingApplication = await getDoc(applicationRef);

  if (existingApplication.exists()) {
    throw new Error("A driver application already exists.");
  }

  // Create-only submission.
  // Firebase Rules enforce the actual security.
  await setDoc(applicationRef, {
    userId: uid,

    name: data.name.trim(),
    email: data.email.trim(),
    phone: data.phone.trim(),
    whatsappNumber: data.whatsappNumber.trim(),
    address: data.address.trim(),

    licenceNumber: data.licenceNumber.trim(),
    vehicleType: data.vehicleType.trim(),
    vehicleNumber: data.vehicleNumber.trim(),

    status: "submitted",
    verificationStatus: "pending",

    createdAt: serverTimestamp()
  });
}


// ============================================
// APPLICATION STATUS
// ============================================

export async function getDriverStatus(uid) {

  const application = await getDriverApplication(uid);

  if (!application) {
    return {
      exists: false,
      status: "not_submitted",
      verificationStatus: "not_submitted"
    };
  }

  return {
    exists: true,
    status: application.status,
    verificationStatus: application.verificationStatus,
    name: application.name
  };
}


// ============================================
// CURRENT USER
// ============================================

export function getCurrentUser() {
  return auth.currentUser;
}


// ============================================
// EXPORT FIREBASE APP
// ============================================

export default app;
