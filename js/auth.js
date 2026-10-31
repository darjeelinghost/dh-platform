
import {
  auth,
  registerUser,
  loginUser,
  logoutUser,
  getUserProfile,
  signInWithGoogle,
  getGoogleRedirectResult,
  sendVerificationEmail,
  refreshAuthUser,
  createUserProfile
} from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";

// ============================================
// PAGE HELPERS
// ============================================

const $ = (selector) => document.querySelector(selector);

function showMessage(message, type = "info") {
  const element = $(
    "#authMessage, #adminMessage, [data-auth-message]"
  );

  if (!element) {
    console.log(message);
    return;
  }

  element.textContent = message;
  element.hidden = false;
  element.style.display = "block";

  element.classList.remove("success", "error", "info");
  element.classList.add(type);
  element.setAttribute("role", "alert");
}

function getValue(...selectors) {
  for (const selector of selectors) {
    const element = $(selector);

    if (element) {
      return element.value?.trim() || "";
    }
  }

  return "";
}

function setButtonLoading(button, loading, originalText) {
  if (!button) return;

  button.disabled = loading;

  if (loading) {
    button.dataset.originalText = button.textContent;
    button.textContent = "Please wait...";
  } else {
    button.textContent =
      originalText ||
      button.dataset.originalText ||
      "Continue";
  }
}

function getCurrentPage() {
  return window.location.pathname.split("/").pop() || "index.html";
}

function redirectByRole(role) {
  if (role === "admin" || role === "superadmin") {
    window.location.replace("admin.html");
  } else {
    window.location.replace("dashboard.html");
  }
}

// ============================================
// ACCOUNT STATUS CHECK
// ============================================

async function checkAccountAccess(user) {
  if (!user) {
    return {
      allowed: false,
      reason: "not-signed-in"
    };
  }

  const tokenResult = await user.getIdTokenResult(true);
  const claims = tokenResult.claims || {};

  if (claims.superadmin === true) {
    return {
      allowed: true,
      role: "superadmin"
    };
  }

  if (claims.admin === true) {
    return {
      allowed: true,
      role: "admin"
    };
  }

  if (!user.emailVerified) {
    return {
      allowed: false,
      reason: "email-unverified"
    };
  }

  const profile = await getUserProfile(user.uid);

  if (!profile) {
    return {
      allowed: false,
      reason: "profile-missing"
    };
  }

  if (profile.status === "pending") {
    return {
      allowed: false,
      reason: "pending"
    };
  }

  if (profile.status === "rejected") {
    return {
      allowed: false,
      reason: "rejected"
    };
  }

  if (profile.status === "suspended") {
    return {
      allowed: false,
      reason: "suspended"
    };
  }

  if (profile.status !== "active") {
    return {
      allowed: false,
      reason: "inactive"
    };
  }

  return {
    allowed: true,
    role: profile.role,
    profile
  };
}

// ============================================
// HANDLE ACCOUNT ACCESS
// ============================================

async function processSignedInUser(user) {
  const result = await checkAccountAccess(user);

  if (!result.allowed) {
    switch (result.reason) {
      case "email-unverified":
        showMessage(
          "Please verify your email before accessing DarjeelingHost. Use the resend verification option.",
          "error"
        );
        break;

      case "pending":
        showMessage(
          "Your registration is awaiting administrator approval.",
          "info"
        );
        break;

      case "rejected":
        showMessage(
          "Your registration was rejected. Please contact platform support.",
          "error"
        );
        break;

      case "suspended":
        showMessage(
          "Your account has been suspended. Please contact platform support.",
          "error"
        );
        break;

      case "profile-missing":
        showMessage(
          "Your account profile is incomplete. Please complete registration.",
          "error"
        );
        break;

      default:
        showMessage(
          "Your account is not currently authorised.",
          "error"
        );
    }

    return false;
  }

  redirectByRole(result.role);
  return true;
}

// ============================================
// EMAIL REGISTRATION
// ============================================

async function handleRegistration(event) {
  event.preventDefault();

  const button = $("#registerForm button[type='submit']");

  const originalText = button?.textContent;

  const fullName = getValue("#fullName");
  const email = getValue("#registerEmail");
  const phone = getValue("#phone");
  const whatsapp = getValue("#whatsapp");
  const role = getValue("#accountType");
  const password = $("#registerPassword")?.value || "";
  const confirmPassword = $("#confirmPassword")?.value || "";
  const termsAccepted = $("#terms")?.checked;

  if (!fullName || !email || !password) {
    showMessage(
      "Please complete all required fields.",
      "error"
    );
    return;
  }

  if (!["driver", "broker"].includes(role)) {
    showMessage(
      "Please select Driver or Broker.",
      "error"
    );
    return;
  }

  if (password.length < 6) {
    showMessage(
      "Your password must contain at least 6 characters.",
      "error"
    );
    return;
  }

  if (password !== confirmPassword) {
    showMessage(
      "Your passwords do not match.",
      "error"
    );
    return;
  }

  if ($("#terms") && !termsAccepted) {
    showMessage(
      "Please accept the terms and conditions.",
      "error"
    );
    return;
  }

  try {
    setButtonLoading(button, true);

    const result = await registerUser({
      email,
      password,
      displayName: fullName,
      phone,
      whatsapp,
      role
    });

    await sendVerificationEmail(result.user);

    showMessage(
      "Registration successful! A verification email has been sent. Verify your email, then return to log in. Your account will still require administrator approval.",
      "success"
    );

    const form = $("#registerForm");

    if (form) {
      form.reset();
    }

  } catch (error) {
    console.error("Registration error:", error);

    showMessage(
      error.code === "auth/email-already-in-use"
        ? "This email is already registered. Please log in instead."
        : error.message || "Registration failed.",
      "error"
    );

  } finally {
    setButtonLoading(button, false, originalText);
  }
}

// ============================================
// EMAIL LOGIN
// ============================================

async function handleLogin(event) {
  event.preventDefault();

  const button = $("#loginForm button[type='submit']");
  const originalText = button?.textContent;

  const email = getValue("#loginEmail");
  const password = $("#loginPassword")?.value || "";

  if (!email || !password) {
    showMessage(
      "Enter your email and password.",
      "error"
    );
    return;
  }

  try {
    setButtonLoading(button, true);

    const user = await loginUser(email, password);

    await processSignedInUser(user);

  } catch (error) {
    console.error("Login error:", error);

    showMessage(
      error.code === "auth/invalid-credential"
        ? "Incorrect email or password."
        : error.message || "Login failed.",
      "error"
    );

  } finally {
    setButtonLoading(button, false, originalText);
  }
}

// ============================================
// RESEND EMAIL VERIFICATION
// ============================================

async function handleResendVerification() {
  try {
    if (!auth.currentUser) {
      showMessage(
        "Please log in first to resend verification.",
        "error"
      );
      return;
    }

    const refreshed = await refreshAuthUser();

    if (refreshed.emailVerified) {
      showMessage(
        "Your email is already verified. You can continue to your account.",
        "success"
      );
      return;
    }

    await sendVerificationEmail(auth.currentUser);

    showMessage(
      "A new verification email has been sent. Check your inbox and spam folder.",
      "success"
    );

  } catch (error) {
    console.error("Verification email error:", error);

    showMessage(
      error.message || "Unable to resend verification email.",
      "error"
    );
  }
}

// ============================================
// GOOGLE SIGN-IN
// ============================================

async function handleGoogleSignIn(event) {
  event?.preventDefault();

  const button = event?.currentTarget ||
    $("[data-google-login]") ||
    $("#googleLogin");

  const originalText = button?.textContent;

  try {
    setButtonLoading(button, true);

    const result = await signInWithGoogle();

    if (result.redirected) {
      return;
    }

    await processGoogleUser(result.user);

  } catch (error) {
    console.error("Google sign-in error:", error);

    showMessage(
      error.message || "Google sign-in failed.",
      "error"
    );

    setButtonLoading(button, false, originalText);
  }
}

async function processGoogleUser(user) {
  if (!user) return;

  const tokenResult = await user.getIdTokenResult(true);
  const claims = tokenResult.claims || {};

  // Existing Admin/Super Admin account.
  if (
    claims.admin === true ||
    claims.superadmin === true
  ) {
    redirectByRole(
      claims.superadmin === true
        ? "superadmin"
        : "admin"
    );

    return;
  }

  // Google normally supplies verified email accounts.
  await user.reload();

  if (!user.emailVerified) {
    showMessage(
      "Your Google email must be verified before continuing.",
      "error"
    );
    return;
  }

  let profile = await getUserProfile(user.uid);

  // New Google user: registration page must supply a role.
  if (!profile) {
    if (getCurrentPage() !== "register.html") {
      showMessage(
        "This is a new Google account. Please complete registration and select Driver or Broker.",
        "info"
      );

      const link = document.createElement("a");
      link.href = "register.html";
      link.textContent = " Complete registration";
      link.style.display = "inline-block";
      link.style.marginTop = "10px";

      $("#authMessage")?.appendChild(link);
      return;
    }

    const role = getValue("#accountType");

    if (!["driver", "broker"].includes(role)) {
      showMessage(
        "Select Driver or Broker before continuing with Google.",
        "error"
      );
      return;
    }

    await createUserProfile(user, {
      displayName:
        user.displayName ||
        getValue("#fullName") ||
        "DarjeelingHost User",
      phone: getValue("#phone"),
      whatsapp: getValue("#whatsapp"),
      role
    });

    profile = await getUserProfile(user.uid);

    showMessage(
      "Google registration successful. Your account is awaiting administrator approval.",
      "success"
    );

    return;
  }

  await processSignedInUser(user);
}

// ============================================
// GOOGLE REDIRECT RESULT
// ============================================

async function handleGoogleRedirect() {
  try {
    const result = await getGoogleRedirectResult();

    if (!result?.user) return;

    await processGoogleUser(result.user);

  } catch (error) {
    console.error("Google redirect error:", error);

    showMessage(
      error.message || "Google sign-in could not be completed.",
      "error"
    );
  }
}

// ============================================
// PASSWORD VISIBILITY
// ============================================

function setupPasswordToggle() {
  document.querySelectorAll("[data-toggle-password]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const targetId = button.dataset.togglePassword;
        const input = document.getElementById(targetId);

        if (!input) return;

        input.type =
          input.type === "password"
            ? "text"
            : "password";
      });
    });
}

// ============================================
// FORM INITIALISATION
// ============================================

function initialiseAuthForms() {
  $("#registerForm")?.addEventListener(
    "submit",
    handleRegistration
  );

  $("#loginForm")?.addEventListener(
    "submit",
    handleLogin
  );

  document.querySelectorAll(
    "#googleLogin, #googleRegister, [data-google-login]"
  ).forEach((button) => {
    button.addEventListener(
      "click",
      handleGoogleSignIn
    );
  });

  document.querySelectorAll(
    "#resendVerification, [data-resend-verification]"
  ).forEach((button) => {
    button.addEventListener(
      "click",
      handleResendVerification
    );
  });

  setupPasswordToggle();
}

// ============================================
// AUTHENTICATION STATE
// ============================================

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const page = getCurrentPage();

  // Only automatically process existing users
  // on the public authentication pages.
  if (
    page === "login.html" ||
    page === "register.html"
  ) {
    // Allow registration page to finish a new Google profile.
    const profile = await getUserProfile(user.uid)
      .catch(() => null);

    if (profile) {
      await processSignedInUser(user);
    }
  }
});

// ============================================
// LOGOUT
// ============================================

async function handleLogout() {
  try {
    await logoutUser();
    window.location.replace("login.html");

  } catch (error) {
    console.error("Logout error:", error);
    showMessage("Unable to log out.", "error");
  }
}

document.querySelectorAll(
  "#logoutButton, [data-logout]"
).forEach((button) => {
  button.addEventListener("click", handleLogout);
});

// ============================================
// GLOBAL AUTH HELPERS
// ============================================

window.DarjAuth = {
  logout: handleLogout,
  resendVerification: handleResendVerification,
  googleSignIn: handleGoogleSignIn,
  checkAccountAccess,
  processSignedInUser
};

// ============================================
// START
// ============================================

initialiseAuthForms();
handleGoogleRedirect();
