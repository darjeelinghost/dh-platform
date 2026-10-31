
import {
  app,
  auth,
  db
} from "./firebase.js";

import {
  onAuthStateChanged,
  getIdTokenResult,
  signOut
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";

import {
  collection,
  getCountFromServer
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";

import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-functions.js";

// =====================================
// CONFIGURATION
// =====================================

const functions = getFunctions(app, "asia-south1");

const ADMIN_FUNCTIONS = {
  approveUser: "approveUser",
  rejectUser: "rejectUser",
  suspendUser: "suspendUser",
  restoreUser: "restoreUser",
  verifyDriver: "verifyDriver",
  rejectDriverVerification: "rejectDriverVerification",
  reviewTrip: "reviewTrip",
  archiveTrip: "archiveTrip",
  restoreTrip: "restoreTrip",
  assignDriver: "assignDriver",
  updatePaymentRecord: "updatePaymentRecord",
  reviewComplaint: "reviewComplaint",
  publishAnnouncement: "publishAnnouncement",
  manageAdminAccess: "manageAdminAccess",
  permanentlyDeleteCompletedTrip: "permanentlyDeleteCompletedTrip"
};

const SUPER_ADMIN_ONLY = new Set([
  "manageAdminAccess",
  "permanentlyDeleteCompletedTrip"
]);

let currentUser = null;
let currentRole = null;
let dashboardReady = false;
let authObserverReady = false;

// =====================================
// DOM HELPERS
// =====================================

function getElement(...selectors) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) return element;
  }

  return null;
}

function showMessage(message, type = "info") {
  const element = getElement(
    "#adminMessage",
    "#authMessage",
    "[data-admin-message]"
  );

  if (!element) {
    console.log(`[Admin ${type}] ${message}`);
    return;
  }

  element.textContent = message;
  element.hidden = false;
  element.style.display = "block";
  element.dataset.type = type;

  element.classList.remove("success", "error", "info");
  element.classList.add(type);
}

function setText(selectors, value) {
  const element = getElement(...selectors);

  if (element) {
    element.textContent = String(value);
  }
}

function setLoading(element, loading, originalText = "") {
  if (!element) return;

  element.disabled = loading;

  if (loading) {
    element.dataset.originalText = element.textContent.trim();
    element.textContent = "Please wait...";
  } else {
    element.textContent =
      originalText ||
      element.dataset.originalText ||
      "Submit";
  }
}

// =====================================
// ACCESS CONTROL
// =====================================

async function denyAccess(message = "Access denied.") {
  showMessage(message, "error");

  try {
    await signOut(auth);
  } catch (error) {
    console.error("Sign-out error:", error);
  }

  window.location.replace("login.html");
}

async function checkAdminAccess(user) {
  if (!user) {
    await denyAccess("Please log in to continue.");
    return false;
  }

  try {
    const tokenResult = await getIdTokenResult(user, true);
    const claims = tokenResult.claims || {};

    const isSuperAdmin = claims.superadmin === true;
    const isAdmin = claims.admin === true || isSuperAdmin;

    if (!isAdmin) {
      await denyAccess(
        "You do not have permission to access this dashboard."
      );
      return false;
    }

    currentUser = user;
    currentRole = isSuperAdmin ? "superadmin" : "admin";

    document.body.dataset.adminRole = currentRole;

    setText(
      ["#adminEmail", "[data-admin-email]"],
      user.email || "Administrator"
    );

    setText(
      ["#adminRole", "[data-admin-role]"],
      currentRole.toUpperCase()
    );

    // Hide Super Admin-only controls from ordinary Admins.
    document.querySelectorAll("[data-superadmin-only]")
      .forEach((element) => {
        element.hidden = !isSuperAdmin;
      });

    return true;

  } catch (error) {
    console.error("Access verification failed:", error);

    await denyAccess(
      "Unable to verify administrator permissions."
    );

    return false;
  }
}

// =====================================
// DASHBOARD STATISTICS
// =====================================

async function getCollectionCount(name) {
  try {
    const snapshot = await getCountFromServer(
      collection(db, name)
    );

    return snapshot.data().count || 0;

  } catch (error) {
    console.error(`Unable to count ${name}:`, error);
    return "—";
  }
}

async function loadDashboardStatistics() {
  const statistics = [
    {
      collection: "users",
      selectors: [
        "#totalUsers",
        "#usersCount",
        "[data-stat='users']"
      ]
    },
    {
      collection: "trips",
      selectors: [
        "#totalTrips",
        "#tripsCount",
        "[data-stat='trips']"
      ]
    },
    {
      collection: "notifications",
      selectors: [
        "#totalNotifications",
        "#notificationsCount",
        "[data-stat='notifications']"
      ]
    },
    {
      collection: "complaints",
      selectors: [
        "#totalComplaints",
        "#complaintsCount",
        "[data-stat='complaints']"
      ]
    }
  ];

  await Promise.all(
    statistics.map(async (item) => {
      const count = await getCollectionCount(item.collection);
      setText(item.selectors, count);
    })
  );
}

// =====================================
// PAYLOAD NORMALISATION
// =====================================

function collectActionPayload(button) {
  const payload = {};

  const allowedFields = [
    "userId",
    "tripId",
    "requestId",
    "complaintId",
    "driverId",
    "targetUid",
    "announcement",
    "status",
    "reason",
    "decision",
    "paymentId",
    "paymentStatus",
    "amountPaid",
    "action",
    "confirm"
  ];

  // Collect explicitly supplied data attributes.
  for (const key of allowedFields) {
    if (button.dataset[key] !== undefined) {
      payload[key] = button.dataset[key];
    }
  }

  // Collect values from an associated form.
  const form = button.closest("form");

  if (form) {
    const formData = new FormData(form);

    for (const [key, value] of formData.entries()) {
      if (allowedFields.includes(key)) {
        payload[key] = value;
      }
    }
  }

  // Convert numerical values.
  if (payload.amountPaid !== undefined) {
    payload.amountPaid = Number(payload.amountPaid);
  }

  // HTML checkbox confirmation.
  if (payload.confirm !== undefined) {
    payload.confirm =
      payload.confirm === true ||
      payload.confirm === "true" ||
      payload.confirm === "on";
  }

  // Ensure action is present for Admin access management.
  if (
    button.dataset.action !== undefined &&
    payload.action === undefined
  ) {
    payload.action = button.dataset.action;
  }

  return payload;
}

// =====================================
// PAYLOAD VALIDATION
// =====================================

function validateActionPayload(action, payload) {
  const requiredFields = {
    approveUser: ["userId"],
    rejectUser: ["userId"],
    suspendUser: ["userId"],
    restoreUser: ["userId"],
    verifyDriver: ["driverId"],
    rejectDriverVerification: ["driverId"],
    reviewTrip: ["tripId", "decision"],
    archiveTrip: ["tripId"],
    restoreTrip: ["tripId"],
    assignDriver: ["tripId", "requestId"],
    updatePaymentRecord: ["paymentId", "paymentStatus"],
    reviewComplaint: ["complaintId", "status"],
    publishAnnouncement: ["announcement"],
    manageAdminAccess: ["targetUid", "action"],
    permanentlyDeleteCompletedTrip: ["tripId", "confirm"]
  };

  const fields = requiredFields[action] || [];

  for (const field of fields) {
    if (
      payload[field] === undefined ||
      payload[field] === null ||
      payload[field] === ""
    ) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  if (
    action === "manageAdminAccess" &&
    !["grant", "revoke"].includes(payload.action)
  ) {
    throw new Error("Select grant or revoke.");
  }

  if (
    action === "reviewTrip" &&
    !["approved", "rejected"].includes(payload.decision)
  ) {
    throw new Error("Invalid trip moderation decision.");
  }

  if (
    action === "updatePaymentRecord" &&
    !["unpaid", "partially_paid", "paid", "disputed"]
      .includes(payload.paymentStatus)
  ) {
    throw new Error("Invalid payment status.");
  }

  if (
    action === "permanentlyDeleteCompletedTrip" &&
    payload.confirm !== true
  ) {
    throw new Error(
      "You must confirm permanent deletion."
    );
  }

  if (
    action === "updatePaymentRecord" &&
    payload.amountPaid !== undefined &&
    (
      !Number.isFinite(payload.amountPaid) ||
      payload.amountPaid < 0
    )
  ) {
    throw new Error("Enter a valid payment amount.");
  }
}

// =====================================
// CLOUD FUNCTION CALLS
// =====================================

async function callAdminFunction(functionName, payload = {}) {
  if (!currentUser || !currentRole) {
    throw new Error(
      "Administrator authentication is required."
    );
  }

  if (!ADMIN_FUNCTIONS[functionName]) {
    throw new Error(
      "This administrative operation is not recognised."
    );
  }

  if (
    SUPER_ADMIN_ONLY.has(functionName) &&
    currentRole !== "superadmin"
  ) {
    throw new Error(
      "Only the Super Admin can perform this operation."
    );
  }

  const callable = httpsCallable(
    functions,
    ADMIN_FUNCTIONS[functionName]
  );

  const result = await callable(payload);

  return result.data;
}

// =====================================
// ADMIN ACTION HANDLER
// =====================================

async function handleAdminAction(button) {
  const action = button.dataset.adminAction;

  if (!action || !ADMIN_FUNCTIONS[action]) {
    showMessage("Invalid administrative action.", "error");
    return;
  }

  if (
    SUPER_ADMIN_ONLY.has(action) &&
    currentRole !== "superadmin"
  ) {
    showMessage(
      "Only the Super Admin can perform this operation.",
      "error"
    );
    return;
  }

  const originalText = button.textContent.trim();

  try {
    const payload = collectActionPayload(button);

    validateActionPayload(action, payload);

    let confirmation = button.dataset.confirmMessage ||
      `Are you sure you want to perform: ${action}?`;

    if (action === "permanentlyDeleteCompletedTrip") {
      confirmation =
        "WARNING: This permanently deletes the completed trip record. Payment and audit records will be retained. Continue?";
    }

    if (!window.confirm(confirmation)) {
      return;
    }

    setLoading(button, true);

    showMessage(
      "Processing administrative request...",
      "info"
    );

    const result = await callAdminFunction(
      action,
      payload
    );

    console.log(`Admin operation ${action}:`, result);

    showMessage(
      result?.message || "Operation completed successfully.",
      "success"
    );

    await loadDashboardStatistics();

    document.dispatchEvent(
      new CustomEvent("darjeelinghost:admin-action", {
        detail: {
          action,
          payload,
          result
        }
      })
    );

  } catch (error) {
    console.error(`Admin action ${action} failed:`, error);

    showMessage(
      error.message || "The operation could not be completed.",
      "error"
    );

  } finally {
    setLoading(button, false, originalText);
  }
}

// =====================================
// EVENT LISTENERS
// =====================================

function setupAdminActions() {
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-admin-action]");

    if (!button) return;

    event.preventDefault();

    if (button.disabled) return;

    await handleAdminAction(button);
  });
}

// =====================================
// LOGOUT
// =====================================

async function logoutAdmin() {
  try {
    await signOut(auth);
    window.location.replace("login.html");

  } catch (error) {
    console.error("Logout failed:", error);

    showMessage(
      "Unable to log out. Please try again.",
      "error"
    );
  }
}

function setupLogout() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest(
      "#adminLogout, [data-admin-logout]"
    );

    if (!button) return;

    event.preventDefault();
    logoutAdmin();
  });
}

// =====================================
// DASHBOARD INITIALISATION
// =====================================

async function initialiseAdminDashboard(user) {
  const hasAccess = await checkAdminAccess(user);

  if (!hasAccess) return;

  if (dashboardReady) return;

  dashboardReady = true;

  setupAdminActions();
  setupLogout();

  await loadDashboardStatistics();

  document.body.classList.add("admin-dashboard-ready");

  document.dispatchEvent(
    new CustomEvent("darjeelinghost:admin-ready", {
      detail: {
        user: currentUser,
        role: currentRole
      }
    })
  );
}

// =====================================
// AUTHENTICATION OBSERVER
// =====================================

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    if (!authObserverReady) {
      authObserverReady = true;
    }

    await denyAccess(
      "Please log in with an administrator account."
    );

    return;
  }

  authObserverReady = true;

  await initialiseAdminDashboard(user);
});

// =====================================
// GLOBAL ADMIN HELPERS
// =====================================

window.DarjAdmin = {
  getCurrentUser: () => currentUser,

  getCurrentRole: () => currentRole,

  isSuperAdmin: () => currentRole === "superadmin",

  refreshStatistics: loadDashboardStatistics,

  callAdminFunction,

  logout: logoutAdmin
};
