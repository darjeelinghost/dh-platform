
import { auth, db, getUserProfile } from "./firebase.js";

import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";


/* =========================================
   1. DASHBOARD INITIALISATION
========================================= */

let currentUser = null;
let currentProfile = null;
let allTrips = [];

const tripContainer =
  document.querySelector(
    "[data-trip-list], #tripList, #availableTrips, #tripResults"
  );

const searchInput =
  document.querySelector(
    "#tripSearch, #searchTrips, [name='tripSearch']"
  );

const vehicleFilter =
  document.querySelector(
    "#vehicleFilter, #vehicleTypeFilter"
  );


/* =========================================
   2. SAFE TEXT HELPERS
========================================= */

function createElement(tag, className, text) {
  const element = document.createElement(tag);

  if (className) {
    element.className = className;
  }

  if (text !== undefined && text !== null) {
    element.textContent = String(text);
  }

  return element;
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
    date = new Date(value + (
      /^\d{4}-\d{2}-\d{2}$/.test(value) ? "T00:00:00" : ""
    ));
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

function normalise(value) {
  return String(value || "").trim().toLowerCase();
}


/* =========================================
   3. SHOW DASHBOARD MESSAGE
========================================= */

function showDashboardMessage(message, type = "info") {
  if (!tripContainer) return;

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


/* =========================================
   4. LOAD USER INFORMATION
========================================= */

async function loadCurrentUser() {
  currentUser = auth.currentUser;

  if (!currentUser) {
    window.location.replace("login.html");
    return false;
  }

  currentProfile = await getUserProfile(currentUser.uid);

  if (!currentProfile) {
    throw new Error("Your user profile could not be found.");
  }

  if (currentProfile.status !== "active") {
    window.location.replace("login.html");
    return false;
  }

  if (!["driver", "broker", "admin", "superadmin"]
      .includes(currentProfile.role)) {
    throw new Error("Your account does not have a valid role.");
  }

  return true;
}


/* =========================================
   5. LOAD TRIPS FROM FIRESTORE
========================================= */

async function loadTrips() {
  if (!tripContainer) {
    console.warn(
      "Trip listing container not found. " +
      "Add an element with id='tripList' to dashboard.html."
    );
    return;
  }

  showDashboardMessage("Loading available trips...");

  try {
    const snapshot = await getDocs(
      collection(db, "trips")
    );

    allTrips = snapshot.docs.map(document => ({
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


/* =========================================
   6. DETERMINE TRIP AVAILABILITY
========================================= */

function isAvailableTrip(trip) {
  const status = normalise(trip.status);

  const availableStatuses = [
    "open",
    "available",
    "posted"
  ];

  if (!availableStatuses.includes(status)) {
    return false;
  }

  if (trip.archived === true || trip.deleted === true) {
    return false;
  }

  if (trip.isDeleted === true) {
    return false;
  }

  if (trip.assignedDriverId) {
    return false;
  }

  if (trip.assignedDriver) {
    return false;
  }

  if (
    currentProfile &&
    trip.postedBy === currentUser.uid
  ) {
    return false;
  }

  return true;
}


/* =========================================
   7. SEARCH AND FILTER
========================================= */

function filterTrips() {
  const search = normalise(searchInput?.value);
  const selectedVehicle = normalise(vehicleFilter?.value);

  return allTrips.filter(trip => {
    if (!isAvailableTrip(trip)) {
      return false;
    }

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


/* =========================================
   8. BUILD TRIP CARD
========================================= */

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
    `Travel Date: ${formatDate(trip.travelDate || trip.date)}`
  );

  const time = createElement(
    "p",
    "trip-time",
    `Pickup Time: ${trip.pickupTime || "Not specified"}`
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
    `Passenger Seats: ${trip.seats ?? trip.passengerSeats ?? "Not specified"}`
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
    `Posted by: ${trip.postedByName || "Platform user"}`
  );

  const details = createElement("div", "trip-information");

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

  card.append(
    tripId,
    heading,
    details,
    button
  );

  return card;
}


/* =========================================
   9. DISPLAY TRIPS
========================================= */

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

  filteredTrips.forEach(trip => {
    tripContainer.appendChild(
      createTripCard(trip)
    );
  });
}


/* =========================================
   10. CONNECT SEARCH AND FILTERS
========================================= */

if (searchInput) {
  searchInput.addEventListener("input", renderTrips);
}

if (vehicleFilter) {
  vehicleFilter.addEventListener("change", renderTrips);
}


/* =========================================
   11. DASHBOARD INITIALISATION
========================================= */

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
      roleElement.textContent = currentProfile.role;
    }

    await loadTrips();

  } catch (error) {
    console.error("Dashboard initialisation error:", error);

    showDashboardMessage(
      error.message || "Unable to initialise your dashboard.",
      "error"
    );
  }
}


/* =========================================
   12. START DASHBOARD
========================================= */

auth.authStateReady()
  .then(initialiseDashboard)
  .catch(error => {
    console.error("Authentication error:", error);
  });


/* =========================================
   13. EXPOSE DASHBOARD FUNCTIONS
========================================= */

window.DarjDashboard = {
  refresh: loadTrips,
  search: renderTrips
};
