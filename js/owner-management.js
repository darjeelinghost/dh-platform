// ============================================
// DARJEELINGHOST - PRIMARY OWNER CONSOLE
// ============================================

import {
  app,
  auth
} from "./firebase.js";

import {
  onAuthStateChanged,
  getIdTokenResult,
  signOut
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";

import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-functions.js";

const functions = getFunctions(app, "asia-south1");

const bootstrapOwner = httpsCallable(
  functions,
  "bootstrapSuperAdmin"
);

const addSuperAdmin = httpsCallable(
  functions,
  "addSuperAdminByEmail"
);

const revokeSuperAdmin = httpsCallable(
  functions,
  "revokeSuperAdminByEmail"
);

const listSuperAdmins = httpsCallable(
  functions,
  "listAdditionalSuperAdmins"
);

const OWNER_EMAIL = "darjeelinghost@gmail.com";

const messageBox = document.getElementById("pageMessage");
const loadingCard = document.getElementById("loadingCard");
const ownerContent = document.getElementById("ownerContent");
const adminList = document.getElementById("adminList");

let currentUser = null;
let ownerReady = false;

function showMessage(message, type = "info") {
  messageBox.textContent = message;
  messageBox.className = `message ${type}`;
}

function errorMessage(error) {
  console.error(error);

  const messages = {
    "unauthenticated": "Please sign in first.",
    "permission-denied": "This account is not authorised as the primary owner.",
    "failed-precondition": "The account or owner configuration is not ready.",
    "not-found": "The requested account or record was not found.",
    "already-exists": "This account already has a Super Admin record.",
    "invalid-argument": "Please check the email address."
  };

  return messages[error?.code] ||
    error?.message ||
    "An unexpected error occurred.";
}

function setBusy(button, busy, text) {
  if (!button) return;

  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = text;
    button.disabled = true;
  } else {
    button.textContent =
      button.dataset.originalText || text;

    button.disabled = false;
  }
}

// ============================================
// VERIFY PRIMARY OWNER
// ============================================

async function verifyPrimaryOwner(user) {
  await user.reload();

  if (!user.emailVerified) {
    throw new Error(
      "Verify the primary owner's email before continuing."
    );
  }

  const tokenResult = await getIdTokenResult(user, true);
  const claims = tokenResult.claims;

  if (
    user.email?.toLowerCase() !== OWNER_EMAIL ||
    claims.primaryOwner !== true ||
    claims.superadmin !== true
  ) {
    throw new Error(
      "Primary owner access has not been configured for this account."
    );
  }

  return true;
}

// ============================================
// LOAD ADDITIONAL SUPER ADMINS
// ============================================

async function loadSuperAdmins() {
  adminList.textContent = "Loading administrators...";

  try {
    const result = await listSuperAdmins();
    const administrators = result.data?.administrators || [];

    if (!administrators.length) {
      adminList.textContent =
        "No additional Super Admin accounts have been added.";
      return;
    }

    adminList.replaceChildren();

    administrators.forEach((administrator) => {
      const item = document.createElement("div");
      item.className = "admin-item";

      const details = document.createElement("div");

      const email = document.createElement("div");
      email.className = "admin-email";
      email.textContent = administrator.email || "Unknown email";

      const status = document.createElement("div");
      status.className = "admin-status";
      status.textContent = "Additional Super Admin";

      details.append(email, status);

      const revokeButton = document.createElement("button");
      revokeButton.className = "danger";
      revokeButton.type = "button";
      revokeButton.textContent = "Revoke Access";

      revokeButton.addEventListener("click", async () => {
        const confirmed = window.confirm(
          `Revoke Super Admin access from ${administrator.email}?`
        );

        if (!confirmed) return;

        setBusy(revokeButton, true, "Revoking...");

        try {
          const response = await revokeSuperAdmin({
            email: administrator.email
          });

          showMessage(
            response.data?.message ||
            "Super Admin access revoked.",
            "success"
          );

          await loadSuperAdmins();

        } catch (error) {
          showMessage(errorMessage(error), "error");
          setBusy(revokeButton, false, "Revoke Access");
        }
      });

      item.append(details, revokeButton);
      adminList.appendChild(item);
    });

  } catch (error) {
    adminList.textContent = errorMessage(error);
  }
}

// ============================================
// ADD SUPER ADMIN
// ============================================

document.getElementById("addAdminForm")
  .addEventListener("submit", async (event) => {
    event.preventDefault();

    const emailInput =
      document.getElementById("newAdminEmail");

    const button =
      document.getElementById("addAdminButton");

    const email = emailInput.value.trim().toLowerCase();

    if (!email) {
      showMessage("Enter an email address.", "error");
      return;
    }

    if (email === OWNER_EMAIL) {
      showMessage(
        "The primary owner already has permanent Super Admin access.",
        "error"
      );
      return;
    }

    setBusy(button, true, "Granting access...");

    try {
      const result = await addSuperAdmin({ email });

      showMessage(
        result.data?.message ||
        "Super Admin access granted.",
        "success"
      );

      emailInput.value = "";
      await loadSuperAdmins();

    } catch (error) {
      showMessage(errorMessage(error), "error");

    } finally {
      setBusy(button, false, "Grant Super Admin Access");
    }
  });

// ============================================
// REFRESH
// ============================================

document.getElementById("refreshAdmins")
  .addEventListener("click", loadSuperAdmins);

// ============================================
// LOGOUT
// ============================================

document.getElementById("ownerLogout")
  .addEventListener("click", async () => {
    await signOut(auth);
    window.location.replace("login.html");
  });

// ============================================
// AUTHENTICATION
// ============================================

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }

  if (ownerReady) return;

  currentUser = user;

  try {
    await verifyPrimaryOwner(user);

    document.getElementById("signedInEmail").textContent =
      user.email || "";

    loadingCard.classList.add("hidden");
    ownerContent.classList.remove("hidden");

    ownerReady = true;

    await loadSuperAdmins();

  } catch (error) {
    loadingCard.textContent = errorMessage(error);
    showMessage(errorMessage(error), "error");
  }
});
