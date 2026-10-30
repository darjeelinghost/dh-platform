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
   updateProfile,
  signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
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
// AUTHENTICATION & USER PROFILE
// ============================================

// Register a new account and initialize /users/{uid} document per firestore.rules
export async function registerUser(email, password, displayName = "") {
  if (!email || !password) {
    throw new Error("Email and password are required.");
  }

  const cleanEmail = email.trim();
  const cleanName = (displayName || cleanEmail.split("@")[0]).trim();

  const credential = await createUserWithEmailAndPassword(
    auth,
    cleanEmail,
    password
  );

  const user = credential.user;

  if (cleanName) {
    await updateProfile(user, { displayName: cleanName });
  }

  // Create /users/{uid} matching exact keys required by firestore.rules
  const userRef = doc(db, "users", user.uid);
  await setDoc(userRef, {
    uid: user.uid,
    email: cleanEmail,
    displayName: cleanName,
    role: "customer",
    status: "active",
    createdAt: serverTimestamp()
  });

  return credential;
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


// Read Firebase Custom Claims (owner, superAdmin, admin, driver)
export async function getUserClaims(forceRefresh = false) {
  if (!auth.currentUser) return null;
  const tokenResult = await auth.currentUser.getIdTokenResult(forceRefresh);
  return {
    owner: tokenResult.claims.owner === true,
    superAdmin: tokenResult.claims.superAdmin === true,
    admin: tokenResult.claims.admin === true,
    driver: tokenResult.claims.driver === true,
    claims: tokenResult.claims
  };
}


// ============================================
// DRIVER APPLICATION
// ============================================

// Get a driver's own application
export async function getDriverApplication(uid) {
  const targetUid = uid || auth.currentUser?.uid;

  if (!targetUid || !auth.currentUser || auth.currentUser.uid !== targetUid) {
    throw new Error("You can only access your own application.");
  }

  const applicationRef = doc(
    db,
    "driverApplications",
    targetUid
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
      throw new Error(`Please complete all required fields (${field} is missing).`);
    }
  }

  const applicationRef = doc(
    db,
    "driverApplications",
    uid
  );

  // Prevent accidental replacement of an existing application.
  // NOTE: Requires `allow read: if isSelf(applicationId) || isAdmin();` in firestore.rules
  const existingApplication = await getDoc(applicationRef);

  if (existingApplication.exists()) {
    throw new Error("A driver application already exists.");
  }

  // Create-only submission matching exact keys in firestore.rules
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
// CUSTOMER ENQUIRIES
// ============================================

export async function submitEnquiry(enquiryData) {
  if (!auth.currentUser) {
    throw new Error("You must be signed in to submit an enquiry.");
  }

  const enquiriesRef = collection(db, "enquiries");
  return await addDoc(enquiriesRef, {
    ...enquiryData,
    customerId: auth.currentUser.uid,
    status: "submitted",
    createdAt: serverTimestamp()
  });
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
