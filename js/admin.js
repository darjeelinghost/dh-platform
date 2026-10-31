
import { auth, db } from "./firebase.js";

import {
  getIdTokenResult
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";

import {
  collection,
  getDocs,
  query,
  where,
  getCountFromServer
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";

import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-functions.js";


/* =========================================
   1. INITIALISE CLOUD FUNCTIONS
========================================= */

const functions = getFunctions(
  auth.app,
  "asia-south1"
);


/* =========================================
   2. ADMIN STATE
========================================= */

let currentAdmin = null;
let currentClaims = null;
let isSuperAdmin = false;


/* =========================================
   3. COMMON HELPERS
========================================= */

function getElement(...selectors) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);

    if (element) return element;
  }

  return null;
}

function showAdminMessage(message, type = "info") {
  let box = document.getElementById("adminMessage");

  if (!box) {
    box = document.createElement("div");
    box.id = "adminMessage";

    const container = getElement(
      ".admin-container",
      "main"
    );

    container?.prepend(box);
  }

  if (!box) return;

  box.textContent = message;
  box.style.padding = "12px";
  box.style.marginBottom = "15px";
  box.style.borderRadius = "8px";

  box.style.background =
    type === "error" ? "#fde7e7" :
    type === "success" ? "#e1f5e8" :
    "#edf3f8";

  box.style.color =
    type === "error" ? "#a52b2b" :
    type === "success" ? "#176b37" :
    "#173f5f";
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-IN");
}


/* =========================================
   4. DENY ADMIN ACCESS
========================================= */

async function denyAccess(message) {
  showAdminMessage(
    message || "You are not authorised to access this page.",
    "error"
  );

  await auth.signOut();

  window.location.replace("login.html");
}


/* =========================================
   5. VERIFY FIREBASE CUSTOM CLAIMS
========================================= */

async function verifyAdminAccess() {
  await auth.authStateReady();

  const user = auth.currentUser;

  if (!user) {
    window.location.replace("login.html");
    return false;
  }

  const tokenResult = await getIdTokenResult(user, true);

  const claims = tokenResult.claims;

  const adminClaim = claims.admin === true;
  const superAdminClaim = claims.superadmin === true;

  if (!adminClaim && !superAdminClaim) {
    await denyAccess(
      "Access denied. Administrative permissions are required."
    );

    return false;
  }

  if (superAdminClaim) {
    isSuperAdmin = true;
  } else {
    isSuperAdmin = false;
  }

  currentAdmin = user;
  currentClaims = claims;

  return true;
}


/* =========================================
   6. DISPLAY ADMIN ROLE
========================================= */

function displayAdminIdentity() {
  const roleLabel = getElement(
    "#adminRoleLabel",
    "[data-admin-role]"
  );

  if (roleLabel) {
    roleLabel.textContent = isSuperAdmin
      ? "SUPER ADMIN"
      : "ADMIN";
  }

  const adminTab = getElement(
    "#adminManagementTab"
  );

  if (adminTab) {
    adminTab.style.display = isSuperAdmin
      ? ""
      : "none";
  }

  if (!isSuperAdmin) {
    const adminSection = document.getElementById("admins");

    if (adminSection) {
      adminSection.style.display = "none";
    }
  }

  const emailElement = getElement(
    "#adminEmail",
    "[data-admin-email]"
  );

  if (emailElement) {
    emailElement.textContent = currentAdmin.email || "";
  }
}


/* =========================================
   7. SAFE FIRESTORE COUNT
========================================= */

async function getCollectionCount(collectionName) {
  try {
    const snapshot = await getCountFromServer(
      collection(db, collectionName)
    );

    return snapshot.data().count;

  } catch (error) {
    console.error(
      `Unable to count ${collectionName}:`,
      error.code || error.message
    );

    return null;
  }
}


/* =========================================
   8. LOAD DASHBOARD STATISTICS
========================================= */

async function loadAdminStatistics() {
  const statistics = {
    users: await getCollectionCount("users"),
    trips: await getCollectionCount("trips"),
    notifications: await getCollectionCount("notifications"),
    complaints: await getCollectionCount("complaints")
  };

  const mappings = {
    users: ["#totalUsers", "[data-stat='users']"],
    trips: ["#totalTrips", "[data-stat='trips']"],
    notifications: [
      "#totalNotifications",
      "[data-stat='notifications']"
    ],
    complaints: [
      "#totalComplaints",
      "[data-stat='complaints']"
    ]
  };

  for (const [key, selectors] of Object.entries(mappings)) {
    const element = getElement(...selectors);

    if (element) {
      element.textContent =
        statistics[key] === null
          ? "Unavailable"
          : formatNumber(statistics[key]);
    }
  }

  return statistics;
}


/* =========================================
   9. LOAD PENDING USER COUNT
========================================= */

async function loadPendingUsers() {
  try {
    const pendingQuery = query(
      collection(db, "users"),
      where("status", "==", "pending")
    );

    const snapshot = await getCountFromServer(pendingQuery);

    const element = getElement(
      "#pendingUsers",
      "[data-stat='pending-users']"
    );

    if (element) {
      element.textContent = formatNumber(
        snapshot.data().count
      );
    }

  } catch (error) {
    console.error(
      "Unable to load pending users:",
      error.code || error.message
    );
  }
}


/* =========================================
   10. LOAD PENDING DRIVER VERIFICATION
========================================= */

async function loadPendingVerification() {
  try {
    const pendingQuery = query(
      collection(db, "users"),
      where("verificationStatus", "==", "pending")
    );

    const snapshot = await getCountFromServer(pendingQuery);

    const element = getElement(
      "#pendingVerification",
      "[data-stat='pending-verification']"
    );

    if (element) {
      element.textContent = formatNumber(
        snapshot.data().count
      );
    }

  } catch (error) {
    console.error(
      "Unable to load verification count:",
      error.code || error.message
    );
  }
}


/* =========================================
   11. SECURE CLOUD FUNCTION CALLER
========================================= */

async function callAdminFunction(functionName, payload = {}) {
  if (!currentAdmin) {
    throw new Error("Administrative authentication is required.");
  }

  if (
    functionName === "manageAdminAccess" &&
    !isSuperAdmin
  ) {
    throw new Error(
      "Only the Super Admin can manage administrator access."
    );
  }

  const callable = httpsCallable(
    functions,
    functionName
  );

  const result = await callable(payload);

  return result.data;
}


/* =========================================
   12. ADMIN ACTION HANDLER
========================================= */

async function performAdminAction(action, payload = {}) {
  const allowedActions = [
    "approveUser",
    "rejectUser",
    "suspendUser",
    "restoreUser",
    "verifyDriver",
    "rejectDriverVerification",
    "reviewTrip",
    "archiveTrip",
    "restoreTrip",
    "updatePaymentRecord",
    "reviewComplaint",
    "publishAnnouncement"
  ];

  if (!allowedActions.includes(action)) {
    throw new Error("This administrative action is not permitted.");
  }

  return await callAdminFunction(action, payload);
}


/* =========================================
   13. SUPER ADMIN ACTIONS
========================================= */

async function manageAdminAccess(payload) {
  if (!isSuperAdmin) {
    throw new Error(
      "Only the Super Admin may grant or revoke Admin access."
    );
  }

  if (!payload.uid || !["grant", "revoke"].includes(payload.action)) {
    throw new Error("Invalid administrator access request.");
  }

  return await callAdminFunction(
    "manageAdminAccess",
    payload
  );
}


/* =========================================
   14. CONNECT ADMIN ACTION BUTTONS
========================================= */

document.addEventListener("click", async event => {
  const button = event.target.closest("[data-admin-action]");

  if (!button) return;

  const action = button.dataset.adminAction;
  const uid = button.dataset.uid;
  const tripId = button.dataset.tripId;

  const payload = {};

  if (uid) payload.uid = uid;
  if (tripId) payload.tripId = tripId;

  if (action === "manageAdminAccess") {
    if (!isSuperAdmin) {
      showAdminMessage(
        "Only the Super Admin can manage Admin access.",
        "error"
      );

      return;
    }

    payload.action = button.dataset.accessAction;
  }

  if (
    !confirm(
      "Are you sure you want to perform this administrative action?"
    )
  ) {
    return;
  }

  const originalText = button.textContent;

  button.disabled = true;
  button.textContent = "Processing...";

  try {
    let result;

    if (action === "manageAdminAccess") {
      result = await manageAdminAccess(payload);
    } else {
      result = await performAdminAction(action, payload);
    }

    showAdminMessage(
      result?.message || "Administrative action completed.",
      "success"
    );

  } catch (error) {
    console.error(
      "Administrative action failed:",
      error.code || error.message
    );

    showAdminMessage(
      error.message || "The action could not be completed.",
      "error"
    );

  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
});


/* =========================================
   15. INITIALISE ADMIN DASHBOARD
========================================= */

async function initialiseAdminDashboard() {
  try {
    const authorised = await verifyAdminAccess();

    if (!authorised) return;

    displayAdminIdentity();

    await Promise.all([
      loadAdminStatistics(),
      loadPendingUsers(),
      loadPendingVerification()
    ]);

  } catch (error) {
    console.error(
      "Admin dashboard initialisation failed:",
      error.code || error.message
    );

    showAdminMessage(
      "Unable to initialise the administration dashboard.",
      "error"
    );
  }
}


/* =========================================
   16. EXPOSE ADMIN FUNCTIONS
========================================= */

window.DarjAdmin = {
  refresh: initialiseAdminDashboard,
  loadStatistics: loadAdminStatistics,
  performAction: performAdminAction,
  manageAdminAccess,
  get isSuperAdmin() {
    return isSuperAdmin;
  }
};


/* =========================================
   17. START
========================================= */

initialiseAdminDashboard();
