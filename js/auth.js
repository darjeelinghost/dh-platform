
import {
  auth,
  registerUser,
  loginUser,
  logoutUser,
  getUserProfile
} from "./firebase.js";


/* =====================================
   1. MESSAGE HANDLING
===================================== */

function showMessage(message, type = "error") {
  let box = document.getElementById("authMessage");

  if (!box) {
    box = document.createElement("div");
    box.id = "authMessage";
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");

    const form = document.querySelector("form");

    if (form) {
      form.before(box);
    } else {
      document.body.prepend(box);
    }
  }

  box.hidden = false;
  box.textContent = message;
  box.style.display = "block";
  box.style.padding = "12px";
  box.style.marginBottom = "15px";
  box.style.borderRadius = "7px";
  box.style.fontSize = "14px";

  if (type === "success") {
    box.style.background = "#e1f5e8";
    box.style.color = "#176b37";
  } else {
    box.style.background = "#fde7e7";
    box.style.color = "#a52b2b";
  }
}


/* =====================================
   2. FORM HELPERS
===================================== */

function getValue(...selectors) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);

    if (element) {
      return element.value.trim();
    }
  }

  return "";
}

function getPassword(...selectors) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);

    if (element) {
      return element.value;
    }
  }

  return "";
}

function setLoading(button, loading, originalText) {
  if (!button) return;

  button.disabled = loading;
  button.textContent = loading
    ? "Please wait..."
    : originalText;
}


/* =====================================
   3. REGISTRATION
===================================== */

const registerForm =
  document.getElementById("registerForm");

if (registerForm) {
  registerForm.addEventListener("submit", async event => {
    event.preventDefault();

    const button = registerForm.querySelector(
      '[type="submit"]'
    );

    const originalText =
      button?.textContent || "Create Account";

    try {
      const displayName = getValue("#fullName");
      const email = getValue("#registerEmail").toLowerCase();
      const phone = getValue("#phone");
      const whatsapp = getValue("#whatsapp");
      const role = getValue("#accountType").toLowerCase();

      const password = getPassword("#registerPassword");
      const confirmPassword = getPassword("#confirmPassword");

      const terms = document.getElementById("terms");

      if (!displayName || !email || !phone || !role) {
        throw new Error("Please complete all required fields.");
      }

      if (!["driver", "broker"].includes(role)) {
        throw new Error("Select Driver or Travel Agent / Broker.");
      }

      if (password.length < 6) {
        throw new Error("Password must contain at least 6 characters.");
      }

      if (password !== confirmPassword) {
        throw new Error("Your passwords do not match.");
      }

      if (!terms?.checked) {
        throw new Error("Please accept the terms and conditions.");
      }

      setLoading(button, true, originalText);

      await registerUser({
        displayName,
        email,
        phone,
        whatsapp,
        role,
        password
      });

      showMessage(
        "Registration successful. Your account is awaiting administrator approval.",
        "success"
      );

      registerForm.reset();

      setTimeout(() => {
        window.location.href = "login.html";
      }, 2500);

    } catch (error) {
      console.error("Registration error:", error);

      showMessage(
        error.message || "Registration failed. Please try again."
      );

    } finally {
      setLoading(button, false, originalText);
    }
  });
}


/* =====================================
   4. LOGIN
===================================== */

const loginForm =
  document.getElementById("loginForm");

if (loginForm) {
  loginForm.addEventListener("submit", async event => {
    event.preventDefault();

    const button = loginForm.querySelector(
      '[type="submit"]'
    );

    const originalText = button?.textContent || "Login";

    try {
      const email = getValue("#loginEmail").toLowerCase();
      const password = getPassword("#loginPassword");

      if (!email || !password) {
        throw new Error("Enter your email and password.");
      }

      setLoading(button, true, originalText);

      const user = await loginUser(email, password);

      const profile = await getUserProfile(user.uid);

      if (!profile) {
        await logoutUser();

        throw new Error(
          "Your account profile was not found. Contact the administrator."
        );
      }

      if (profile.status === "suspended") {
        await logoutUser();

        throw new Error(
          "Your account is suspended. Contact the administrator."
        );
      }

      if (profile.status !== "active") {
        await logoutUser();

        throw new Error(
          "Your account is awaiting administrator approval."
        );
      }

      const validRoles = [
        "driver",
        "broker",
        "admin",
        "superadmin"
      ];

      if (!validRoles.includes(profile.role)) {
        await logoutUser();

        throw new Error("Invalid account permissions.");
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
        error.message || "Login failed. Please try again."
      );

    } finally {
      setLoading(button, false, originalText);
    }
  });
}


/* =====================================
   5. LOGOUT BUTTONS
===================================== */

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


/* =====================================
   6. PROTECTED PAGE CHECK
===================================== */

async function checkCurrentPage(user) {
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

    const isAdmin = [
      "admin",
      "superadmin"
    ].includes(profile.role);

    if (currentPage === "admin.html" && !isAdmin) {
      window.location.replace("dashboard.html");
    }

  } catch (error) {
    console.error("Page access check failed:", error);

    await logoutUser();
    window.location.replace("login.html");
  }
}


/* =====================================
   7. AUTHENTICATION INITIALISATION
===================================== */

auth.authStateReady()
  .then(() => {
    return checkCurrentPage(auth.currentUser);
  })
  .catch(error => {
    console.error("Authentication initialisation failed:", error);
  });


/* =====================================
   8. GLOBAL AUTH ACCESS
===================================== */

window.DarjAuth = {
  logout: async () => {
    await logoutUser();
    window.location.href = "login.html";
  }
};
