
import {
  auth,
  registerUser,
  loginUser,
  logoutUser,
  getUserProfile
} from "./firebase.js";


/* =========================================
   1. COMMON HELPERS
========================================= */

function getField(...selectors) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);

    if (element) return element;
  }

  return null;
}

function getValue(...selectors) {
  return getField(...selectors)?.value?.trim() || "";
}

function showMessage(message, type = "error") {
  let messageBox = document.getElementById("authMessage");

  if (!messageBox) {
    messageBox = document.createElement("div");
    messageBox.id = "authMessage";

    const form = document.querySelector("form");

    if (form) {
      form.prepend(messageBox);
    } else {
      document.body.prepend(messageBox);
    }
  }

  messageBox.textContent = message;
  messageBox.style.padding = "12px";
  messageBox.style.marginBottom = "15px";
  messageBox.style.borderRadius = "7px";
  messageBox.style.fontSize = "14px";

  if (type === "success") {
    messageBox.style.background = "#e1f5e8";
    messageBox.style.color = "#176b37";
  } else {
    messageBox.style.background = "#fde7e7";
    messageBox.style.color = "#a52b2b";
  }
}

function setLoading(button, loading, originalText) {
  if (!button) return;

  button.disabled = loading;
  button.textContent = loading ? "Please wait..." : originalText;
}


/* =========================================
   2. REGISTRATION
========================================= */

const registerForm =
  document.getElementById("registerForm") ||
  document.querySelector('form[data-auth="register"]');

if (registerForm) {
  registerForm.addEventListener("submit", async function(event) {
    event.preventDefault();

    const submitButton =
      registerForm.querySelector('[type="submit"]');

    const originalText =
      submitButton?.textContent || "Create Account";

    const displayName = getValue(
      "#fullName",
      "#displayName",
      '[name="fullName"]',
      '[name="displayName"]'
    );

    const email = getValue(
      "#registerEmail",
      "#email",
      '[name="email"]'
    ).toLowerCase();

    const phone = getValue(
      "#phone",
      '[name="phone"]'
    );

    const whatsapp = getValue(
      "#whatsapp",
      '[name="whatsapp"]'
    );

    const role = getValue(
      "#accountType",
      "#role",
      '[name="accountType"]',
      '[name="role"]'
    ).toLowerCase();

    const password =
      getField("#registerPassword", "#password", '[name="password"]')
        ?.value || "";

    const confirmPassword =
      getField(
        "#confirmPassword",
        "#confirm-password",
        '[name="confirmPassword"]'
      )?.value || "";

    const terms = getField(
      "#terms",
      "#agreeTerms",
      '[name="terms"]'
    );

    try {
      if (!displayName || !email || !phone || !role || !password) {
        throw new Error("Please complete all required fields.");
      }

      if (!["driver", "broker"].includes(role)) {
        throw new Error("Please select Driver or Travel Agent / Broker.");
      }

      if (password.length < 6) {
        throw new Error("Password must contain at least 6 characters.");
      }

      if (password !== confirmPassword) {
        throw new Error("Your passwords do not match.");
      }

      if (terms && !terms.checked) {
        throw new Error("Please accept the terms and conditions.");
      }

      setLoading(submitButton, true, originalText);

      await registerUser({
        displayName,
        email,
        phone,
        whatsapp,
        role,
        password
      });

      showMessage(
        "Registration successful. Your account is pending administrator approval.",
        "success"
      );

      registerForm.reset();

      setTimeout(() => {
        window.location.href = "login.html";
      }, 2000);

    } catch (error) {
      console.error("Registration error:", error);

      showMessage(
        error.message || "Registration failed. Please try again."
      );

    } finally {
      setLoading(submitButton, false, originalText);
    }
  });
}


/* =========================================
   3. LOGIN
========================================= */

const loginForm =
  document.getElementById("loginForm") ||
  document.querySelector('form[data-auth="login"]');

if (loginForm) {
  loginForm.addEventListener("submit", async function(event) {
    event.preventDefault();

    const submitButton =
      loginForm.querySelector('[type="submit"]');

    const originalText =
      submitButton?.textContent || "Login";

    const email = getValue(
      "#loginEmail",
      "#email",
      '[name="email"]'
    ).toLowerCase();

    const password =
      getField("#loginPassword", "#password", '[name="password"]')
        ?.value || "";

    try {
      if (!email || !password) {
        throw new Error("Please enter your email and password.");
      }

      setLoading(submitButton, true, originalText);

      const user = await loginUser(email, password);

      const profile = await getUserProfile(user.uid);

      if (!profile) {
        await logoutUser();

        throw new Error(
          "Your user profile could not be found. Please contact the administrator."
        );
      }

      if (profile.status === "suspended") {
        await logoutUser();

        throw new Error(
          "Your account has been suspended. Please contact the administrator."
        );
      }

      if (profile.status !== "active") {
        await logoutUser();

        showMessage(
          "Your account is awaiting administrator approval. Please try again after verification."
        );

        return;
      }

      if (
        !["driver", "broker", "admin", "superadmin"]
          .includes(profile.role)
      ) {
        await logoutUser();

        throw new Error("Your account has an invalid role.");
      }

      showMessage("Login successful. Redirecting...", "success");

      if (
        profile.role === "admin" ||
        profile.role === "superadmin"
      ) {
        window.location.href = "admin.html";
      } else {
        window.location.href = "dashboard.html";
      }

    } catch (error) {
      console.error("Login error:", error);

      showMessage(
        error.message || "Login failed. Please check your credentials."
      );

    } finally {
      setLoading(submitButton, false, originalText);
    }
  });
}


/* =========================================
   4. LOGOUT BUTTONS
========================================= */

document.querySelectorAll("[data-logout]").forEach(button => {
  button.addEventListener("click", async () => {
    try {
      await logoutUser();
      window.location.href = "login.html";
    } catch (error) {
      console.error("Logout error:", error);
      showMessage("Unable to log out. Please try again.");
    }
  });
});


/* =========================================
   5. AUTHENTICATION CHECK
========================================= */

async function checkCurrentUser() {
  const protectedPages = [
    "dashboard.html",
    "driver-profile.html",
    "notifications.html",
    "trip-details.html",
    "trip-history.html",
    "admin.html"
  ];

  const currentPage =
    window.location.pathname.split("/").pop();

  if (!protectedPages.includes(currentPage)) {
    return;
  }

  const user = auth.currentUser;

  if (!user) {
    window.location.replace("login.html");
    return;
  }

  try {
    const profile = await getUserProfile(user.uid);

    if (!profile || profile.status !== "active") {
      await logoutUser();
      window.location.replace("login.html");
      return;
    }

    const isAdmin =
      profile.role === "admin" ||
      profile.role === "superadmin";

    if (currentPage === "admin.html" && !isAdmin) {
      window.location.replace("dashboard.html");
      return;
    }

    if (
      currentPage !== "admin.html" &&
      isAdmin
    ) {
      // Admin users may access ordinary pages too.
      // No redirect is required.
    }

  } catch (error) {
    console.error("Authentication check failed:", error);
    await logoutUser();
    window.location.replace("login.html");
  }
}


/* =========================================
   6. INITIALISE AUTHENTICATION CHECK
========================================= */

auth.authStateReady()
  .then(checkCurrentUser)
  .catch(error => {
    console.error("Authentication initialisation failed:", error);
  });


/* =========================================
   7. GLOBAL LOGOUT FUNCTION
========================================= */

window.DarjAuth = {
  logout: async function() {
    await logoutUser();
    window.location.href = "login.html";
  }
};
