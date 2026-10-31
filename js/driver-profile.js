
import { auth, getUserProfile, updateUserProfile, logoutUser } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";

const form = document.getElementById("driverForm");
const messageBox = document.getElementById("profileMessage");
const saveButton = document.getElementById("saveProfileBtn");

const fields = {
  fullName: document.getElementById("fullName"),
  email: document.getElementById("email"),
  phone: document.getElementById("phone"),
  whatsapp: document.getElementById("whatsapp"),
  address: document.getElementById("address"),
  area: document.getElementById("area"),
  experience: document.getElementById("experience"),
  about: document.getElementById("about"),
  vehicleType: document.getElementById("vehicleType"),
  vehicleModel: document.getElementById("vehicleModel"),
  registration: document.getElementById("registration"),
  seats: document.getElementById("seats"),
  colour: document.getElementById("colour")
};

let currentUser = null;
let currentProfile = null;

function showMessage(text, type = "error") {
  messageBox.textContent = text;
  messageBox.className = `message show ${type}`;
}

function clearMessage() {
  messageBox.textContent = "";
  messageBox.className = "message";
}

function setLoading(isLoading) {
  saveButton.disabled = isLoading;
  saveButton.textContent = isLoading ? "Saving..." : "Save Profile";
}

function setFieldValue(field, value) {
  if (field) field.value = value ?? "";
}

function displayVerificationStatus(profile) {
  const statusElement = document.getElementById("verificationStatus");

  const status = profile.verificationStatus || "pending";

  const labels = {
    pending: "Verification Pending",
    approved: "Verified Driver",
    verified: "Verified Driver",
    rejected: "Verification Rejected"
  };

  statusElement.textContent = labels[status] || "Verification Pending";
}

function populateProfile(profile, user) {
  const vehicle = profile.vehicle || {};

  setFieldValue(fields.fullName, profile.displayName);
  setFieldValue(fields.email, user.email);
  setFieldValue(fields.phone, profile.phone);
  setFieldValue(fields.whatsapp, profile.whatsapp);
  setFieldValue(fields.address, profile.address);
  setFieldValue(fields.area, profile.operatingArea);
  setFieldValue(fields.experience, profile.experience);
  setFieldValue(fields.about, profile.introduction);

  setFieldValue(fields.vehicleType, vehicle.type);
  setFieldValue(fields.vehicleModel, vehicle.model);
  setFieldValue(fields.registration, vehicle.registration);
  setFieldValue(fields.seats, vehicle.seats);
  setFieldValue(fields.colour, vehicle.colour);

  document.getElementById("profileName").textContent =
    profile.displayName || "Driver";

  document.getElementById("profileArea").textContent =
    profile.operatingArea || "Operating area not added";

  document.getElementById("profileAvatar").textContent =
    (profile.displayName || "D").trim().charAt(0).toUpperCase();

  displayVerificationStatus(profile);
}

function getFormData() {
  const experience = fields.experience.value.trim();
  const seats = fields.seats.value.trim();

  return {
    displayName: fields.fullName.value.trim(),
    phone: fields.phone.value.trim(),
    whatsapp: fields.whatsapp.value.trim(),
    address: fields.address.value.trim(),
    operatingArea: fields.area.value.trim(),
    experience: experience === "" ? 0 : Number(experience),
    introduction: fields.about.value.trim(),

    vehicle: {
      type: fields.vehicleType.value,
      model: fields.vehicleModel.value.trim(),
      registration: fields.registration.value.trim().toUpperCase(),
      seats: seats === "" ? 0 : Number(seats),
      colour: fields.colour.value.trim()
    }
  };
}

function validateProfile(data) {
  if (!data.displayName) {
    return "Please enter your full name.";
  }

  if (!data.phone) {
    return "Please enter your phone number.";
  }

  if (!data.operatingArea) {
    return "Please enter your operating area.";
  }

  if (!data.vehicle.type || !data.vehicle.model) {
    return "Please select your vehicle type and enter its model.";
  }

  if (!Number.isFinite(data.experience) ||
      data.experience < 0 || data.experience > 60) {
    return "Please enter valid driving experience.";
  }

  if (data.vehicle.seats !== 0 &&
      (!Number.isInteger(data.vehicle.seats) ||
       data.vehicle.seats < 1 ||
       data.vehicle.seats > 50)) {
    return "Please enter a valid passenger seat count.";
  }

  return null;
}

async function loadProfile(user) {
  try {
    currentUser = user;

    if (!user) {
      window.location.replace("login.html");
      return;
    }

    const profile = await getUserProfile(user.uid);

    if (!profile) {
      showMessage("Your account profile could not be found. Please contact support.");
      form.hidden = true;
      return;
    }

    if (profile.role !== "driver") {
      showMessage("This page is available to registered driver accounts only.");
      form.hidden = true;
      return;
    }

    currentProfile = profile;
    populateProfile(profile, user);

  } catch (error) {
    console.error("Profile loading error:", error);
    showMessage("Unable to load your profile. Please refresh and try again.");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage();

  if (!currentUser || !currentProfile) {
    showMessage("Your account is not ready. Please sign in again.");
    return;
  }

  const data = getFormData();
  const validationError = validateProfile(data);

  if (validationError) {
    showMessage(validationError);
    return;
  }

  setLoading(true);

  try {
    await updateUserProfile(currentUser.uid, data);

    currentProfile = {
      ...currentProfile,
      ...data
    };

    populateProfile(currentProfile, currentUser);

    showMessage("Your profile has been saved successfully.", "success");

  } catch (error) {
    console.error("Profile update error:", error);

    if (error.code === "permission-denied") {
      showMessage("Firebase denied this update. Please check your Firestore security rules.");
    } else {
      showMessage(error.message || "Unable to save your profile. Please try again.");
    }
  } finally {
    setLoading(false);
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  try {
    await logoutUser();
    window.location.replace("login.html");
  } catch (error) {
    console.error("Logout error:", error);
    showMessage("Unable to log out. Please try again.");
  }
});

onAuthStateChanged(auth, (user) => {
  loadProfile(user);
});
