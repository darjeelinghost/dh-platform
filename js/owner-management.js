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

const OWNER_EMAIL = "darjeelinghost@gmail.com";

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

const messageBox = document.getElementById("pageMessage");
const loadingCard = document.getElementById("loadingCard");
const ownerContent = document.getElementById("ownerContent");
const adminList = document.getElementById("adminList");
const bootstrapCard = document.getElementById("bootstrapCard");
const managementCard = document.getElementById("managementCard");
const listCard = document.getElementById("listCard");

let currentUser = null;
let ownerInitialised = false;
let operationRunning = false;

// ============================================
// MESSAGES
// ============================================

function showMessage(message, type = "info") {
  messageBox.textContent = message;
  messageBox.className = `message ${type}`;
}

function errorMessage(error) {
  console.error("Owner console error:", error);

  const code = error?.code || "";

  const messages = {
    "functions/unauthenticated":
      "Please sign in first.",

    "functions/permission-denied":
      "This account is not authorised as the primary owner.",

    "functions/failed-precondition":
      "The owner configuration or account is not ready.",

    "functions/not-found":
      "The requested account or record was not found.",

    "functions/already-exists":
      "This account or bootstrap record already exists.",

    "functions/invalid-argument":
      "Please check the information you entered.",

    "functions/unavailable":
      "Firebase Functions is temporarily unavailable."
  };

  return messages[code] ||
    error?.message ||
    "An unexpected error occurred.";
}

function setBusy(button, busy, busyText, normalText) {
  if (!button) return;

  button.disabled = busy;
  button.textContent = busy ? busyText : normalText;
}

// ============================================
// OWNER IDENTITY CHECK
// This checks email first.
// Bootstrap establishes the owner claims.
// ============================================

async function verifyOwnerIdentity(user) {
  await user.reload();

  if (!user.emailVerified) {
    throw new Error(
      "Verify the primary owner's email before continuing."
    );
  }

  if (
    String(user.email || "").toLowerCase() !== OWNER_EMAIL
  ) {
    throw new Error(
      "This page is restricted to the configured primary owner."
    );
  }

  return true;
}

// ============================================
// CHECK OWNER CUSTOM CLAIMS
// ============================================

async function hasOwnerClaims(user) {
  const result = await getIdTokenResult(user, true);
  const claims = result.claims;

  return (
    claims.primaryOwner === true &&
    claims.superadmin === true &&
    claims.admin === true
  );
}

// ============================================
// INITIALISE PRIMARY OWNER
// ============================================

document.getElementById("bootstrapButton")
  .addEventListener("click", async () => {

    if (!currentUser || operationRunning) return;

    const button = document.getElementById("bootstrapButton");

    const confirmed = window.confirm(
      "Initialise darjeelinghost@gmail.com as the protected primary owner?"
    );

    if (!confirmed) return;

    operationRunning = true;

    setBusy(
      button,
      true,
      "Initialising...",
      "Initialise Owner Access"
    );

    try {
      await verifyOwnerIdentity(currentUser);

      const result = await bootstrapOwner();

      await currentUser.getIdToken(true);

      const ready = await hasOwnerClaims(currentUser);

      if (!ready) {
        throw new Error(
          "The function completed, but owner permissions have not refreshed. Sign out and sign in again."
        );
      }

      ownerInitialised = true;

      showMessage(
        result.data?.message ||
        "Primary owner access initialised.",
        "success"
      );

      updateOwnerInterface(true);
      await loadSuperAdmins();

    } catch (error) {
      showMessage(errorMessage(error), "error");

    } finally {
      operationRunning = false;

      setBusy(
        button,
        false,
        "Initialising...",
        "Initialise Owner Access"
      );
    }
  });

// ============================================
// UPDATE INTERFACE
// ============================================

function updateOwnerInterface(initialised) {
  ownerInitialised = initialised;

  bootstrapCard.classList.toggle("hidden", initialised);
  managementCard.classList.toggle("hidden", !initialised);
  listCard.classList.toggle("hidden", !initialised);

  document.getElementById("ownerStatus").textContent =
    initialised
      ? "Primary Owner — Active"
      : "Email verified — Owner setup required";
}

// ============================================
// LOAD ADDITIONAL SUPER ADMINS
// ============================================

async function loadSuperAdmins() {
  if (!ownerInitialised) {
    adminList.textContent =
      "Initialise primary owner access first.";
    return;
  }

  adminList.textContent = "Loading administrators...";

  try {
    const result = await listSuperAdmins();

    const administrators =
      result.data?.administrators || [];

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
        if (operationRunning) return;

        const confirmed = window.confirm(
          `Revoke Super Admin access from ${administrator.email}?`
        );

        if (!confirmed) return;

        operationRunning = true;

        setBusy(
          revokeButton,
          true,
          "Revoking...",
          "Revoke Access"
        );

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

        } finally {
          operationRunning = false;

          setBusy(
            revokeButton,
            false,
            "Revoking...",
            "Revoke Access"
          );
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
// ADD ADDITIONAL SUPER ADMIN
// ============================================

document.getElementById("addAdminForm")
  .addEventListener("submit", async (event) => {

    event.preventDefault();

    if (!ownerInitialised || operationRunning) {
      showMessage(
        "Initialise owner access before adding administrators.",
        "error"
      );
      return;
    }

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
        "The primary owner already has protected Super Admin access.",
        "error"
      );
      return;
    }

    const confirmed = window.confirm(
      `Grant additional Super Admin access to ${email}?`
    );

    if (!confirmed) return;

    operationRunning = true;

    setBusy(
      button,
      true,
      "Granting access...",
      "Grant Super Admin Access"
    );

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
      operationRunning = false;

      setBusy(
        button,
        false,
        "Granting access...",
        "Grant Super Admin Access"
      );
    }
  });

// ============================================
// REFRESH ADMINISTRATORS
// ============================================

document.getElementById("refreshAdmins")
  .addEventListener("click", loadSuperAdmins);

// ============================================
// LOGOUT
// ============================================

document.getElementById("ownerLogout")
  .addEventListener("click", async () => {
    try {
      await signOut(auth);
      window.location.replace("login.html");
    } catch (error) {
      showMessage(errorMessage(error), "error");
    }
  });

// ============================================
// AUTHENTICATION OBSERVER
// ============================================

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }

  currentUser = user;

  loadingCard.textContent = "Checking primary owner identity...";

  try {
    await verifyOwnerIdentity(user);

    document.getElementById("signedInEmail").textContent =
      user.email || "";

    ownerContent.classList.remove("hidden");
    loadingCard.classList.add("hidden");

    const initialised = await hasOwnerClaims(user);

    updateOwnerInterface(initialised);

    if (initialised) {
      showMessage(
        "Primary owner access verified.",
        "success"
      );

      await loadSuperAdmins();

    } else {
      showMessage(
        "Your email is verified. Complete the initial owner setup.",
        "info"
      );
    }

  } catch (error) {
    loadingCard.textContent = errorMessage(error);
    showMessage(errorMessage(error), "error");
  }
});
