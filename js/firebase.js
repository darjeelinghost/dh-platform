
// ============================================
// DARJEELINGHOST V1 - FIREBASE CONFIGURATION
// ============================================

import {
  initializeApp,
  getApps,
  getApp
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  deleteUser
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";

// ============================================
// FIREBASE PROJECT CONFIGURATION
// ============================================

const firebaseConfig = {
  apiKey: "AIzaSyD1JZNg8nu_YvDFgJHRSkCqetQIH_k3jyo",
  authDomain: "easyvara.firebaseapp.com",
  projectId: "easyvara",
  storageBucket: "easyvara.firebasestorage.app",
  messagingSenderId: "992724937897",
  appId: "1:992724937897:web:4d7166d7690d34a1b90db8",
  measurementId: "G-FRW5QJTF9X"
};

// ============================================
// INITIALISE FIREBASE
// ============================================

const app = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);

// Keep users signed in across browser sessions.
const persistenceReady = setPersistence(
  auth,
  browserLocalPersistence
).catch((error) => {
  console.error(
    "Firebase persistence setup failed:",
    error
  );
});

// ============================================
// USER PROFILE CONFIGURATION
// ============================================

const ALLOWED_ROLES = [
  "driver",
  "broker"
];

const ALLOWED_PROFILE_FIELDS = [
  "displayName",
  "phone",
  "whatsapp",
  "address",
  "operatingArea",
  "experience",
  "introduction",
  "vehicle",
  "photoURL"
];

// ============================================
// HELPER FUNCTIONS
// ============================================

function requireValue(value, fieldName) {
  if (
    value === undefined ||
    value === null ||
    String(value).trim() === ""
  ) {
    throw new Error(`${fieldName} is required.`);
  }
}

function cleanProfileData(data = {}) {
  const cleaned = {};

  for (const field of ALLOWED_PROFILE_FIELDS) {
    if (
      Object.prototype.hasOwnProperty.call(data, field)
    ) {
      cleaned[field] = data[field];
    }
  }

  return cleaned;
}

function getUsersCollectionReference(uid) {
  requireValue(uid, "User ID");

  return doc(db, "users", uid);
}

// ============================================
// REGISTER USER
// Supports:
// registerUser({ email, password, ...profile })
// registerUser(email, password, profile)
// ============================================

async function registerUser(
  emailOrData,
  password,
  additionalProfile = {}
) {
  await persistenceReady;

  let email;
  let userPassword;
  let profile;

  if (
    typeof emailOrData === "object" &&
    emailOrData !== null
  ) {
    const data = emailOrData;

    email = data.email;
    userPassword = data.password;

    profile = {
      ...data
    };

    delete profile.email;
    delete profile.password;

  } else {
    email = emailOrData;
    userPassword = password;

    profile = {
      ...additionalProfile
    };
  }

  requireValue(email, "Email");
  requireValue(userPassword, "Password");

  const role = profile.role || "driver";

  if (!ALLOWED_ROLES.includes(role)) {
    throw new Error(
      "Only Driver and Broker registrations are permitted."
    );
  }

  const displayName =
    profile.displayName ||
    profile.fullName ||
    "";

  requireValue(displayName, "Full name");

  // Create Firebase Authentication account.
  const credential = await createUserWithEmailAndPassword(
    auth,
    String(email).trim(),
    userPassword
  );

  const user = credential.user;

  try {
    // Create the initial Firestore user profile.
    await createUserProfile(user, {
      displayName,
      phone: profile.phone || "",
      whatsapp: profile.whatsapp || "",
      role
    });

    return {
      user,
      uid: user.uid,
      role,
      status: "pending"
    };

  } catch (error) {
    console.error(
      "User profile creation failed:",
      error
    );

    // Avoid leaving an orphaned Authentication account.
    try {
      await deleteUser(user);
    } catch (deleteError) {
      console.error(
        "Could not roll back Authentication account:",
        deleteError
      );
    }

    throw new Error(
      "Your account profile could not be created. Please try again or contact support."
    );
  }
}

// ============================================
// LOGIN USER
// ============================================

async function loginUser(email, password) {
  await persistenceReady;

  requireValue(email, "Email");
  requireValue(password, "Password");

  const credential = await signInWithEmailAndPassword(
    auth,
    String(email).trim(),
    password
  );

  return credential.user;
}

// ============================================
// LOGOUT USER
// ============================================

async function logoutUser() {
  await signOut(auth);
}

// ============================================
// AUTHENTICATION OBSERVER
// ============================================

function observeAuth(callback) {
  if (typeof callback !== "function") {
    throw new Error(
      "Authentication callback must be a function."
    );
  }

  return onAuthStateChanged(auth, callback);
}

// ============================================
// GET USER PROFILE
// ============================================

async function getUserProfile(uid = auth.currentUser?.uid) {
  requireValue(uid, "User ID");

  const userReference = getUsersCollectionReference(uid);

  const snapshot = await getDoc(userReference);

  if (!snapshot.exists()) {
    return null;
  }

  return {
    uid: snapshot.id,
    ...snapshot.data()
  };
}

// ============================================
// CREATE USER PROFILE
// ============================================

async function createUserProfile(userOrUid, profileData = {}) {
  const uid =
    typeof userOrUid === "string"
      ? userOrUid
      : userOrUid?.uid;

  requireValue(uid, "User ID");

  const email =
    typeof userOrUid === "object"
      ? userOrUid?.email || ""
      : auth.currentUser?.email || "";

  const role = profileData.role || "driver";

  if (!ALLOWED_ROLES.includes(role)) {
    throw new Error(
      "Invalid registration role."
    );
  }

  const userReference = getUsersCollectionReference(uid);

  const existingProfile = await getDoc(userReference);

  if (existingProfile.exists()) {
    throw new Error(
      "A profile already exists for this account."
    );
  }

  const displayName =
    profileData.displayName ||
    profileData.fullName ||
    "";

  requireValue(displayName, "Full name");

  const profile = {
    uid,
    displayName,
    phone: profileData.phone || "",
    whatsapp: profileData.whatsapp || "",
    email,
    role,
    status: "pending",
    verificationStatus: "pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await setDoc(userReference, profile);

  return profile;
}

// ============================================
// UPDATE USER PROFILE
// Users cannot change their own role,
// account status or verification status.
// ============================================

async function updateUserProfile(uid, updates = {}) {
  requireValue(uid, "User ID");

  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error(
      "You must be logged in to update your profile."
    );
  }

  if (currentUser.uid !== uid) {
    throw new Error(
      "You cannot update another user's profile."
    );
  }

  const safeUpdates = cleanProfileData(updates);

  if (Object.keys(safeUpdates).length === 0) {
    throw new Error(
      "No valid profile information was supplied."
    );
  }

  safeUpdates.updatedAt = serverTimestamp();

  const userReference = getUsersCollectionReference(uid);

  await updateDoc(
    userReference,
    safeUpdates
  );

  return true;
}

// ============================================
// EXPORT FIREBASE SERVICES
// ============================================

export {
  app,
  auth,
  db,
  persistenceReady,

  registerUser,
  loginUser,
  logoutUser,
  observeAuth,

  getUserProfile,
  createUserProfile,
  updateUserProfile
};
