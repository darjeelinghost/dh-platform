
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
  updatePaymentRecord: "updatePaymentRecord",
  reviewComplaint: "reviewComplaint",
  publishAnnouncement: "publishAnnouncement",
  manageAdminAccess: "manageAdminAccess"
};

let currentUser = null;
let currentRole = null;
let dashboardReady = false;

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

  element.classList.remove(
    "success",
    "error",
    "info"
  );

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
    element.dataset.originalText =
      element.textContent.trim();

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

  await signOut(auth);

  window.location.replace("login.html");
}

async function checkAdminAccess(user) {
  if (!user) {
    await denyAccess("Please log in to continue.");
    return false;
  }

  try {
    const tokenResult = await getIdTokenResult(
      user,
      true
    );

    const claims = tokenResult.claims || {};

    const isSuperAdmin =
      claims.superadmin === true;

    const isAdmin =
      claims.admin === true || isSuperAdmin;

    if (!isAdmin) {
      await denyAccess(
        "You do not have permission to access this dashboard."
      );

      return false;
    }

    currentUser = user;

    currentRole = isSuperAdmin
      ? "superadmin"
      : "admin";

    document.body.dataset.adminRole = currentRole;

    setText(
      ["#adminEmail", "[data-admin-email]"],
      user.email || "Administrator"
    );

    setText(
      ["#adminRole", "[data-admin-role]"],
      currentRole.toUpperCase()
    );

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
    console.error(
      `Unable to count ${name}:`,
      error
    );

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
      const count = await getCollectionCount(
        item.collection
      );

      setText(item.selectors, count);
    })
  );
}

// =====================================
// CLOUD FUNCTION CALLS
// =====================================

async function callAdminFunction(
  functionName,
  payload = {}
) {
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
    showMessage(
      "Invalid administrative action.",
      "error"
    );

    return;
  }

  // Only Super Admin can manage administrator access.
  if (
    action === "manageAdminAccess" &&
    currentRole !== "superadmin"
  ) {
    showMessage(
      "Only the Super Admin can manage administrator access.",
      "error"
    );

    return;
  }

  const payload = {};

  // Read explicitly supplied data attributes.
  [
    "userId",
    "tripId",
    "requestId",
    "complaintId",
    "driverId",
    "targetUid",
    "announcement",
    "status",
    "reason",
    "amount",
    "paymentStatus",
    "decision",
    "role"
  ].forEach((key) => {
    if (button.dataset[key] !== undefined) {
      payload[key] = button.dataset[key];
    }
  });

  // Include form fields from an associated form, if present.
  const form = button.closest("form");

  if (form) {
    const formData = new FormData(form);

    for (const [key, value] of formData.entries()) {
      payload[key] = value;
    }
  }

  const confirmation = button.dataset.confirm ||
    `Are you sure you want to perform: ${action}?`;

  if (!window.confirm(confirmation)) {
    return;
  }

  const originalText = button.textContent.trim();

  try {
    setLoading(button, true);

    showMessage(
      "Processing administrative request...",
      "info"
    );

    const result = await callAdminFunction(
      action,
      payload
    );

    console.log(
      `Admin operation ${action} completed:`,
      result
    );

    showMessage(
      result?.message ||
      "The request was processed successfully.",
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
    console.error(
      `Admin action ${action} failed:`,
      error
    );

    showMessage(
      error.message ||
      "The operation could not be completed.",
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
    const button = event.target.closest(
      "[data-admin-action]"
    );

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

  document.body.classList.add(
    "admin-dashboard-ready"
  );

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
    await denyAccess(
      "Please log in with an administrator account."
    );

    return;
  }

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
