
import { auth, db, getUserProfile } from "./firebase.js";

import {
  getIdTokenResult
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";

import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";

// ============================================
// DARJEELINGHOST V1 - USER DASHBOARD
// Role normalisation and administrator routing
// ============================================

let currentUser = null;
let currentProfile = null;
let allTrips = [];

const tripContainer = document.querySelector(
  "[data-trip-list], #tripList, #availableTrips, #tripResults"
);

const searchInput = document.querySelector(
  "#tripSearch, #searchTrips, [name='tripSearch']"
);

const vehicleFilter = document.querySelector(
  "#vehicleFilter, #vehicleTypeFilter"
);

// ============================================
// ROLE HELPERS
// ============================================

function normaliseRole(role) {
  const value = String(role || "").trim().toLowerCase();

  if (value === "superadmin" || value === "super_admin") {
    return "superadmin";
  }

  if (value === "admin") return "admin";
  if (value === "driver") return "driver";
  if (value === "broker") return "broker";

  return "";
}

// ============================================
// DOM HELPERS
// ============================================

function createElement(tag, className, text) {
  const element = document.createElement(tag);

  if (className) element.className = className;

  if (text !== undefined && text !== null) {
    element.textContent = String(text);
  }

  return element;
}

function showDashboardMessage(message, type = "info") {
  if (!tripContainer) {
    console.log(message);
    return;
  }

  tripContainer.replaceChildren();

  const box = createElement(
    "div",
    "dashboard-message",
    message
  );

  box.style.padding = "18px";
  box.style.margin = "15px 0";
  box.style.borderRadius = "8px";
  box.style.background =
    type === "error" ? "#fde7e7" : "#edf3f8";

  box.style.color =
    type === "error" ? "#a52b2b" : "#263746";

  tripContainer.appendChild(box);
}

function normalise(value) {
  return String(value || "").trim().toLowerCase();
}

function formatMoney(value) {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return "Fare not specified";
  }

  return "₹" + amount.toLocaleString("en-IN");
}

function formatDate(value) {
  if (!value) return "Date not specified";

  let date;

  if (typeof value === "string") {
    date = new Date(
      value + (
        /^\d{4}-\d{2}-\d{2}$/.test(value)
          ? "T00:00:00"
          : ""
      )
    );
  } else if (value.toDate) {
    date = value.toDate();
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) {
    return "Date not specified";
  }

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

// ============================================
// LOAD AND VERIFY CURRENT USER
// ============================================

async function loadCurrentUser() {
  currentUser = auth.currentUser;

  if (!currentUser) {
    window.location.replace("login.html");
    return false;
  }

  // Always refresh claims before checking permissions.
  const tokenResult = await getIdTokenResult(
    currentUser,
    true
  );

  const claims = tokenResult.claims || {};

  // Actual Firebase administrator permissions take priority.
  if (claims.superadmin === true) {
    window.location.replace("admin.html");
    return false;
  }

  if (claims.admin === true) {
    window.location.replace("admin.html");
    return false;
  }

  currentProfile = await getUserProfile(currentUser.uid);

  if (!currentProfile) {
    throw new Error(
      "Your user profile could not be found."
    );
  }

  const role = normaliseRole(currentProfile.role);

  // A profile role alone does not grant administrator access.
  if (role === "superadmin" || role === "admin") {
    throw new Error(
      "Your profile identifies you as an administrator, but Firebase administrator permissions have not been activated. Please complete the secure Super Admin setup."
    );
  }

  if (!["driver", "broker"].includes(role)) {
    throw new Error(
      "Your account does not have a valid role. Contact platform support."
    );
  }

  if (currentProfile.status !== "active") {
    window.location.replace("login.html");
    return false;
  }

  if (!currentUser.emailVerified) {
    window.location.replace("login.html");
    return false;
  }

  // Use the normalised role throughout the dashboard.
  currentProfile.role = role;

  return true;
}

// ============================================
// LOAD AVAILABLE TRIPS
// ============================================

async function loadTrips() {
  if (!tripContainer) {
    console.warn(
      "Trip listing container not found."
    );
    return;
  }

  showDashboardMessage("Loading available trips...");

  try {
    const snapshot = await getDocs(
      collection(db, "trips")
    );

    allTrips = snapshot.docs.map((document) => ({
      id: document.id,
      ...document.data()
    }));

    renderTrips();

  } catch (error) {
    console.error("Unable to load trips:", error);

    showDashboardMessage(
      "Unable to load trips. Please refresh the page or try again.",
      "error"
    );
  }
}

// ============================================
// TRIP AVAILABILITY
// ============================================

function isAvailableTrip(trip) {
  const status = normalise(trip.status);

  if (!["open", "available", "posted"].includes(status)) {
    return false;
  }

  if (
    trip.archived === true ||
    trip.deleted === true ||
    trip.isDeleted === true
  ) {
    return false;
  }

  if (
    trip.assignedDriverUid ||
    trip.assignedDriverId ||
    trip.assignedDriver
  ) {
    return false;
  }

  if (
    currentProfile &&
    trip.posterUid === currentUser.uid
  ) {
    return false;
  }

  // Only approved listings should appear in the marketplace.
  if (
    trip.moderationStatus &&
    normalise(trip.moderationStatus) !== "approved"
  ) {
    return false;
  }

  return true;
}

// ============================================
// SEARCH AND FILTER
// ============================================

function filterTrips() {
  const search = normalise(searchInput?.value);
  const selectedVehicle = normalise(vehicleFilter?.value);

  return allTrips.filter((trip) => {
    if (!isAvailableTrip(trip)) return false;

    const searchableText = [
      trip.id,
      trip.source,
      trip.destination,
      trip.pickupLocation,
      trip.vehicleType,
      trip.tripType,
      trip.description
    ].map(normalise).join(" ");

    const matchesSearch =
      !search || searchableText.includes(search);

    const matchesVehicle =
      !selectedVehicle ||
      selectedVehicle === "all" ||
      normalise(trip.vehicleType) === selectedVehicle;

    return matchesSearch && matchesVehicle;
  });
}

// ============================================
// CREATE TRIP CARD
// ============================================

function createTripCard(trip) {
  const card = createElement("article", "trip-card");

  card.style.background = "#ffffff";
  card.style.border = "1px solid #e0e6eb";
  card.style.borderRadius = "10px";
  card.style.padding = "18px";
  card.style.marginBottom = "15px";

  const heading = createElement(
    "h3",
    "trip-route",
    `${trip.source || "Source"} → ${trip.destination || "Destination"}`
  );

  const tripId = createElement(
    "small",
    "trip-id",
    `Trip ID: ${trip.id}`
  );

  const date = createElement(
    "p",
    "trip-date",
    `Travel Date: ${formatDate(trip.travelDate)}`
  );

  const time = createElement(
    "p",
    "trip-time",
    `Pickup Time: ${trip.travelTime || "Not specified"}`
  );

  const pickup = createElement(
    "p",
    "trip-pickup",
    `Pickup Location: ${trip.pickupLocation || trip.source || "Not specified"}`
  );

  const vehicle = createElement(
    "p",
    "trip-vehicle",
    `Vehicle: ${trip.vehicleType || "Not specified"}`
  );

  const seats = createElement(
    "p",
    "trip-seats",
    `Passenger Seats: ${trip.seats ?? "Not specified"}`
  );

  const type = createElement(
    "p",
    "trip-type",
    `Trip Type: ${trip.tripType || "Not specified"}`
  );

  const fare = createElement(
    "h3",
    "trip-fare",
    formatMoney(trip.fare)
  );

  const negotiable = createElement(
    "p",
    "trip-negotiable",
    trip.negotiable === true
      ? "Fare is negotiable"
      : "Fare is fixed"
  );

  const description = createElement(
    "p",
    "trip-description",
    trip.description || "No additional instructions."
  );

  const poster = createElement(
    "p",
    "trip-poster",
    `Posted by: ${trip.posterName || "Platform user"}`
  );

  const details = createElement(
    "div",
    "trip-information"
  );

  details.append(
    date,
    time,
    pickup,
    vehicle,
    seats,
    type,
    fare,
    negotiable,
    description,
    poster
  );

  const button = createElement(
    "button",
    "btn",
    "View Trip"
  );

  button.type = "button";

  button.addEventListener("click", () => {
    const url = new URL(
      "trip-details.html",
      window.location.href
    );

    url.searchParams.set("id", trip.id);

    window.location.href = url.toString();
  });

  card.append(tripId, heading, details, button);

  return card;
}

// ============================================
// DISPLAY TRIPS
// ============================================

function renderTrips() {
  if (!tripContainer) return;

  const filteredTrips = filterTrips();

  tripContainer.replaceChildren();

  if (filteredTrips.length === 0) {
    const empty = createElement(
      "div",
      "empty-trips",
      "No available trips match your search."
    );

    empty.style.padding = "25px";
    empty.style.textAlign = "center";

    tripContainer.appendChild(empty);
    return;
  }

  filteredTrips.forEach((trip) => {
    tripContainer.appendChild(
      createTripCard(trip)
    );
  });
}

// ============================================
// SEARCH EVENTS
// ============================================

if (searchInput) {
  searchInput.addEventListener("input", renderTrips);
}

if (vehicleFilter) {
  vehicleFilter.addEventListener("change", renderTrips);
}

document.querySelector("#searchTrips")?.addEventListener(
  "click",
  renderTrips
);

// ============================================
// INITIALISE DASHBOARD
// ============================================

async function initialiseDashboard() {
  try {
    const authenticated = await loadCurrentUser();

    if (!authenticated) return;

    const nameElement = document.querySelector(
      "#userName, #dashboardUserName, [data-user-name]"
    );

    if (nameElement) {
      nameElement.textContent =
        currentProfile.displayName || "User";
    }

    const roleElement = document.querySelector(
      "#userRole, #dashboardUserRole, [data-user-role]"
    );

    if (roleElement) {
      roleElement.textContent =
        currentProfile.role.toUpperCase();
    }

    await loadTrips();

  } catch (error) {
    console.error(
      "Dashboard initialisation error:",
      error
    );

    showDashboardMessage(
      error.message || "Unable to initialise your dashboard.",
      "error"
    );
  }
}

// ============================================
// START
// ============================================

auth.authStateReady()
  .then(initialiseDashboard)
  .catch((error) => {
    console.error("Authentication error:", error);

    showDashboardMessage(
      "Unable to verify your login. Please sign in again.",
      "error"
    );
  });

// ============================================
// PUBLIC DASHBOARD HELPERS
// ============================================

window.DarjDashboard = {
  refresh: loadTrips,
  search: renderTrips
};
