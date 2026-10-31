
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

// ============================================
// DARJEELINGHOST AUTHENTICATION V1
// ============================================

const $ = (selector) => document.querySelector(selector);

let googleProcessing = false;

// ============================================
// MESSAGE HELPERS
// ============================================

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
// ACCOUNT ACCESS CHECK
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

  // Trusted custom claims take precedence.
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

  await user.reload();

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
// PROCESS SIGNED-IN ACCOUNT
// ============================================

async function processSignedInUser(user) {
  const result = await checkAccountAccess(user);

  if (!result.allowed) {
    switch (result.reason) {
      case "email-unverified":
        showMessage(
          "Please verify your email before accessing DarjeelingHost. You can request another verification email below.",
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
  const termsAccepted = $("#terms")?.checked === true;

  if (!fullName || !email || !password) {
    showMessage(
      "Please complete all required fields.",
      "error"
    );
    return;
  }

  if (!["driver", "broker"].includes(role)) {
    showMessage(
      "Please select Driver or Travel Agent / Broker.",
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

  if (!termsAccepted) {
    showMessage(
      "Please accept the terms and conditions before registering.",
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

    try {
      await sendVerificationEmail(result.user);

      showMessage(
        "Registration successful! A verification email has been sent. Verify your email, then sign in. Your account will still require administrator approval.",
        "success"
      );

    } catch (verificationError) {
      console.error(
        "Verification email could not be sent:",
        verificationError
      );

      showMessage(
        "Your account was created, but the verification email could not be sent. Sign in and use Resend Verification Email.",
        "info"
      );
    }

    $("#registerForm")?.reset();

  } catch (error) {
    console.error("Registration error:", error);

    let message = error.message || "Registration failed.";

    if (error.code === "auth/email-already-in-use") {
      message = "This email is already registered. Please sign in instead.";
    }

    if (error.code === "auth/invalid-email") {
      message = "Please enter a valid email address.";
    }

    showMessage(message, "error");

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
      "Enter your email address and password.",
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

    let message = error.message || "Login failed.";

    if (
      error.code === "auth/invalid-credential" ||
      error.code === "auth/wrong-password" ||
      error.code === "auth/user-not-found"
    ) {
      message = "Incorrect email or password.";
    }

    showMessage(message, "error");

  } finally {
    setButtonLoading(button, false, originalText);
  }
}

// ============================================
// RESEND VERIFICATION EMAIL
// ============================================

async function handleResendVerification() {
  try {
    if (!auth.currentUser) {
      showMessage(
        "Please sign in with your email and password first.",
        "error"
      );
      return;
    }

    const refreshed = await refreshAuthUser();

    if (refreshed.emailVerified) {
      showMessage(
        "Your email is already verified. You can sign in to your account.",
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
    console.error("Verification error:", error);

    showMessage(
      error.message || "Unable to send verification email.",
      "error"
    );
  }
}

// ============================================
// GOOGLE SIGN-IN
// ============================================

async function handleGoogleSignIn(event) {
  event?.preventDefault();

  if (googleProcessing) return;

  const button = event?.currentTarget ||
    $("#googleLogin") ||
    $("#googleRegister");

  const originalText = button?.textContent;

  const page = getCurrentPage();

  try {
    // A Google registration must accept terms.
    // Existing Google accounts do not need to accept again.
    if (page === "register.html") {
      const role = getValue("#accountType");

      if (!["driver", "broker"].includes(role)) {
        showMessage(
          "Please select Driver or Travel Agent / Broker before continuing with Google.",
          "error"
        );
        return;
      }

      if ($("#terms")?.checked !== true) {
        showMessage(
          "Please accept the terms and conditions before registering with Google.",
          "error"
        );
        return;
      }
    }

    googleProcessing = true;

    setButtonLoading(button, true);

    const result = await signInWithGoogle();

    // The browser is navigating to Google's sign-in page.
    if (result.redirected) {
      return;
    }

    await processGoogleUser(result.user);

  } catch (error) {
    console.error("Google sign-in error:", error);

    let message = error.message || "Google sign-in failed.";

    if (error.code === "auth/popup-closed-by-user") {
      message = "Google sign-in was cancelled.";
    }

    if (error.code === "auth/unauthorized-domain") {
      message = "This website domain is not authorised for Google sign-in. Check Firebase Authorized Domains.";
    }

    if (error.code === "auth/account-exists-with-different-credential") {
      message = "An account already exists with this email using another sign-in method. Sign in using that method first.";
    }

    showMessage(message, "error");

  } finally {
    googleProcessing = false;

    setButtonLoading(button, false, originalText);
  }
}

// ============================================
// PROCESS GOOGLE USER
// ============================================

async function processGoogleUser(user) {
  if (!user) return;

  await user.reload();

  const tokenResult = await user.getIdTokenResult(true);
  const claims = tokenResult.claims || {};

  // Existing administrator accounts.
  if (claims.superadmin === true) {
    redirectByRole("superadmin");
    return;
  }

  if (claims.admin === true) {
    redirectByRole("admin");
    return;
  }

  if (!user.emailVerified) {
    showMessage(
      "Your Google email must be verified before continuing.",
      "error"
    );
    return;
  }

  const page = getCurrentPage();

  let profile = await getUserProfile(user.uid);

  // ========================================
  // NEW GOOGLE ACCOUNT
  // ========================================

  if (!profile) {
    if (page !== "register.html") {
      showMessage(
        "Your Google account is recognised, but registration is incomplete. Open the registration page, select Driver or Broker, accept the terms and continue with Google.",
        "info"
      );

      const link = document.createElement("a");

      link.href = "register.html";
      link.textContent = "Complete registration";
      link.style.display = "inline-block";
      link.style.marginTop = "10px";

      $("#authMessage")?.appendChild(link);

      return;
    }

    const role = getValue("#accountType");
    const termsAccepted = $("#terms")?.checked === true;

    if (!["driver", "broker"].includes(role)) {
      showMessage(
        "Select Driver or Broker before registering.",
        "error"
      );
      return;
    }

    if (!termsAccepted) {
      showMessage(
        "Accept the terms and conditions before completing Google registration.",
        "error"
      );
      return;
    }

    // Recheck immediately before profile creation.
    profile = await getUserProfile(user.uid);

    if (!profile) {
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
    }

    if (!profile) {
      showMessage(
        "Your Google account was created, but its profile could not be loaded. Please contact support.",
        "error"
      );
      return;
    }

    showMessage(
      "Google registration successful. Your account is awaiting administrator approval.",
      "success"
    );

    return;
  }

  // ========================================
  // EXISTING GOOGLE ACCOUNT
  // ========================================

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

        const visible = input.type === "password";

        input.type = visible ? "text" : "password";
        button.textContent = visible ? "Hide" : "Show";
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

  $("#googleLogin")?.addEventListener(
    "click",
    handleGoogleSignIn
  );

  $("#googleRegister")?.addEventListener(
    "click",
    handleGoogleSignIn
  );

  document.querySelectorAll("[data-google-login]")
    .forEach((button) => {
      button.addEventListener(
        "click",
        handleGoogleSignIn
      );
    });

  $("#resendVerification")?.addEventListener(
    "click",
    handleResendVerification
  );

  document.querySelectorAll("[data-resend-verification]")
    .forEach((button) => {
      button.addEventListener(
        "click",
        handleResendVerification
      );
    });

  setupPasswordToggle();
}

// ============================================
// LOGOUT
// ============================================

async function handleLogout() {
  try {
    await logoutUser();

    window.location.replace("login.html");

  } catch (error) {
    console.error("Logout error:", error);

    showMessage(
      "Unable to log out. Please try again.",
      "error"
    );
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
// START AUTHENTICATION
// ============================================

initialiseAuthForms();
handleGoogleRedirect();
