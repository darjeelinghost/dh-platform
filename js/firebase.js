
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";

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


/* =========================================
   1. FIREBASE CONFIGURATION
========================================= */

const firebaseConfig = {
  apiKey: "AIzaSyD1JZNg8nu_YvDFgJHRSkCqetQIH_k3jyo",
  authDomain: "easyvara.firebaseapp.com",
  projectId: "easyvara",
  storageBucket: "easyvara.firebasestorage.app",
  messagingSenderId: "992724937897",
  appId: "1:992724937897:web:4d7166d7690d34a1b90db8",
  measurementId: "G-FRW5QJTF9X"
};


/* =========================================
   2. INITIALISE FIREBASE
========================================= */

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);

const db = getFirestore(app);


/* =========================================
   3. USER PROFILE VALIDATION
========================================= */

const allowedRegistrationRoles = ["driver", "broker"];

function cleanText(value, maxLength = 150) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function validateRegistrationData(data) {
  const displayName = cleanText(data.displayName, 100);
  const phone = cleanText(data.phone, 25);
  const whatsapp = cleanText(data.whatsapp, 25);
  const role = cleanText(data.role, 30).toLowerCase();

  if (!displayName) {
    throw new Error("Please enter your full name.");
  }

  if (!phone) {
    throw new Error("Please enter your phone number.");
  }

  if (!allowedRegistrationRoles.includes(role)) {
    throw new Error("Please select a valid account type.");
  }

  return {
    displayName,
    phone,
    whatsapp,
    role
  };
}


/* =========================================
   4. CREATE USER PROFILE
========================================= */

async function createUserProfile(uid, profileData) {
  if (!uid) {
    throw new Error("A valid user ID is required.");
  }

  const profile = validateRegistrationData(profileData);

  const userRef = doc(db, "users", uid);

  const existingProfile = await getDoc(userRef);

  if (existingProfile.exists()) {
    throw new Error("A profile already exists for this account.");
  }

  const newProfile = {
    uid,
    displayName: profile.displayName,
    phone: profile.phone,
    whatsapp: profile.whatsapp,
    email: cleanText(profileData.email, 254).toLowerCase(),
    role: profile.role,
    status: "pending",
    verificationStatus: "pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await setDoc(userRef, newProfile);

  return newProfile;
}


/* =========================================
   5. REGISTER USER
========================================= */

async function registerUser(userData) {
  const profile = validateRegistrationData(userData);

  const email = cleanText(userData.email, 254).toLowerCase();
  const password = String(userData.password ?? "");

  if (!email || !email.includes("@")) {
    throw new Error("Please enter a valid email address.");
  }

  if (password.length < 6) {
    throw new Error("Password must contain at least 6 characters.");
  }

  const credential = await createUserWithEmailAndPassword(
    auth,
    email,
    password
  );

  try {
    await updateProfile(credential.user, {
      displayName: profile.displayName
    });

    const savedProfile = await createUserProfile(
      credential.user.uid,
      {
        ...profile,
        email
      }
    );

    return {
      user: credential.user,
      profile: savedProfile
    };

  } catch (error) {
    // Do not silently delete the authentication account.
    // A failed profile creation must be investigated and recovered.
    console.error("User profile creation failed:", error);

    throw new Error(
      "Your authentication account was created, but your profile " +
      "could not be saved. Please contact the administrator."
    );
  }
}


/* =========================================
   6. LOGIN USER
========================================= */

async function loginUser(email, password) {
  const cleanEmail = cleanText(email, 254).toLowerCase();

  if (!cleanEmail || !password) {
    throw new Error("Please enter your email and password.");
  }

  const credential = await signInWithEmailAndPassword(
    auth,
    cleanEmail,
    password
  );

  return credential.user;
}


/* =========================================
   7. LOGOUT USER
========================================= */

async function logoutUser() {
  await signOut(auth);
}


/* =========================================
   8. AUTHENTICATION STATE
========================================= */

function observeAuth(callback) {
  if (typeof callback !== "function") {
    throw new Error("Authentication callback must be a function.");
  }

  return onAuthStateChanged(auth, callback);
}


/* =========================================
   9. GET USER PROFILE
========================================= */

async function getUserProfile(uid) {
  if (!uid) {
    throw new Error("A user ID is required.");
  }

  const userRef = doc(db, "users", uid);

  const snapshot = await getDoc(userRef);

  if (!snapshot.exists()) {
    return null;
  }

  return snapshot.data();
}


/* =========================================
   10. UPDATE USER PROFILE
========================================= */

// Only ordinary profile fields are editable here.
// Role, status and verification permissions are excluded.

async function updateUserProfile(uid, updates) {
  const currentUser = auth.currentUser;

  if (!currentUser || currentUser.uid !== uid) {
    throw new Error("You can only update your own profile.");
  }

  const allowedFields = [
    "displayName",
    "phone",
    "whatsapp",
    "address",
    "operatingArea",
    "experience",
    "introduction"
  ];

  const safeUpdates = {};

  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(updates, field)) {
      safeUpdates[field] = cleanText(
        updates[field],
        field === "introduction" ? 1000 : 250
      );
    }
  }

  if (Object.keys(safeUpdates).length === 0) {
    throw new Error("No valid profile changes were provided.");
  }

  safeUpdates.updatedAt = serverTimestamp();

  await updateDoc(doc(db, "users", uid), safeUpdates);

  if (safeUpdates.displayName) {
    await updateProfile(currentUser, {
      displayName: safeUpdates.displayName
    });
  }

  return true;
}


/* =========================================
   11. EXPORT FIREBASE SERVICES
========================================= */

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


/* =========================================
   12. OPTIONAL GLOBAL ACCESS
========================================= */

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
