
/* =========================================
   DARJEELINGHOST V1
   MAIN WEBSITE JAVASCRIPT
========================================= */


/* =========================================
   1. COMMON INITIALISATION
========================================= */

document.addEventListener("DOMContentLoaded", () => {
  initialiseMobileNavigation();
  highlightActiveNavigation();
  initialiseCurrentYear();
  initialiseBackToTop();
  initialiseFormProtection();
});


/* =========================================
   2. MOBILE NAVIGATION
========================================= */

function initialiseMobileNavigation() {
  const header = document.querySelector(".site-header");
  const nav = header?.querySelector("nav");

  if (!header || !nav) return;

  let menuButton = document.getElementById("mobileMenuButton");

  if (!menuButton) {
    menuButton = document.createElement("button");
    menuButton.id = "mobileMenuButton";
    menuButton.type = "button";
    menuButton.setAttribute("aria-label", "Toggle navigation");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.innerHTML = "☰";

    menuButton.style.border = "none";
    menuButton.style.background = "transparent";
    menuButton.style.fontSize = "25px";
    menuButton.style.cursor = "pointer";
    menuButton.style.padding = "8px";
    menuButton.style.color = "inherit";

    header.querySelector(".container")?.appendChild(menuButton);
  }

  const style = document.createElement("style");

  style.textContent = `
    @media (max-width: 768px) {
      .site-header nav {
        display: none;
        width: 100%;
        flex-direction: column;
        gap: 12px;
        padding: 15px 0;
      }

      .site-header nav.mobile-open {
        display: flex;
      }

      #mobileMenuButton {
        display: block;
      }
    }

    @media (min-width: 769px) {
      #mobileMenuButton {
        display: none;
      }

      .site-header nav {
        display: flex;
      }
    }
  `;

  document.head.appendChild(style);

  menuButton.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("mobile-open");

    menuButton.setAttribute(
      "aria-expanded",
      String(isOpen)
    );

    menuButton.innerHTML = isOpen ? "✕" : "☰";
  });

  nav.querySelectorAll("a").forEach(link => {
    link.addEventListener("click", () => {
      nav.classList.remove("mobile-open");
      menuButton.setAttribute("aria-expanded", "false");
      menuButton.innerHTML = "☰";
    });
  });
}


/* =========================================
   3. ACTIVE NAVIGATION LINK
========================================= */

function highlightActiveNavigation() {
  const currentPage =
    window.location.pathname.split("/").pop() || "index.html";

  document.querySelectorAll(".site-header nav a").forEach(link => {
    const linkPage = link.getAttribute("href");

    if (!linkPage || linkPage.startsWith("#")) return;

    const cleanLink = linkPage.split("?")[0];

    if (cleanLink === currentPage) {
      link.classList.add("active");

      link.setAttribute("aria-current", "page");
    } else {
      link.classList.remove("active");

      link.removeAttribute("aria-current");
    }
  });
}


/* =========================================
   4. CURRENT YEAR
========================================= */

function initialiseCurrentYear() {
  const year = new Date().getFullYear();

  document.querySelectorAll("[data-current-year]").forEach(element => {
    element.textContent = year;
  });
}


/* =========================================
   5. BACK TO TOP
========================================= */

function initialiseBackToTop() {
  const button = document.getElementById("backToTop");

  if (!button) return;

  button.addEventListener("click", () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  });
}


/* =========================================
   6. FORM DOUBLE-SUBMISSION PROTECTION
========================================= */

function initialiseFormProtection() {
  document.querySelectorAll(
    "form[data-prevent-double-submit]"
  ).forEach(form => {

    form.addEventListener("submit", () => {
      const submitButton = form.querySelector(
        '[type="submit"]'
      );

      if (!submitButton) return;

      if (form.dataset.submitting === "true") return;

      form.dataset.submitting = "true";
      submitButton.disabled = true;

      setTimeout(() => {
        form.dataset.submitting = "false";
        submitButton.disabled = false;
      }, 5000);
    });
  });
}


/* =========================================
   7. COMMON CONFIRMATION DIALOG
========================================= */

function confirmAction(message) {
  return window.confirm(
    message || "Are you sure you want to continue?"
  );
}


/* =========================================
   8. COMMON ALERT MESSAGE
========================================= */

function showSiteMessage(message, type = "info") {
  let container = document.getElementById("siteMessage");

  if (!container) {
    container = document.createElement("div");
    container.id = "siteMessage";

    container.style.position = "fixed";
    container.style.top = "15px";
    container.style.left = "50%";
    container.style.transform = "translateX(-50%)";
    container.style.zIndex = "9999";
    container.style.maxWidth = "90%";
    container.style.padding = "13px 18px";
    container.style.borderRadius = "8px";
    container.style.boxShadow = "0 4px 15px rgba(0,0,0,.15)";

    document.body.appendChild(container);
  }

  const colours = {
    success: {
      background: "#e1f5e8",
      color: "#176b37"
    },
    error: {
      background: "#fde7e7",
      color: "#a52b2b"
    },
    info: {
      background: "#e8eef5",
      color: "#173f5f"
    }
  };

  const selected = colours[type] || colours.info;

  container.style.background = selected.background;
  container.style.color = selected.color;
  container.textContent = message;

  container.style.display = "block";

  clearTimeout(container.hideTimer);

  container.hideTimer = setTimeout(() => {
    container.style.display = "none";
  }, 4000);
}


/* =========================================
   9. EXPOSE COMMON UTILITIES
========================================= */

window.DarjMain = {
  confirmAction,
  showSiteMessage
};
