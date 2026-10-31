
"use strict";

// ======================================================
// DARJEELINGHOST V1 - SECURE FIREBASE BACKEND
// Firebase Functions v2 + Firebase Admin SDK
// ======================================================

const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const {
  getFirestore,
  FieldValue
} = require("firebase-admin/firestore");

const {
  onCall,
  HttpsError
} = require("firebase-functions/v2/https");

const { defineString } = require("firebase-functions/params");
const { setGlobalOptions } = require("firebase-functions/v2");

// Initialise Firebase Admin before loading owner.js.
initializeApp();

// Owner and additional Super Admin management
const ownerFunctions = require("./owner");

const db = getFirestore();
const adminAuth = getAuth();

setGlobalOptions({
  region: "asia-south1",
  maxInstances: 10
});

const OWNER_UID = defineString("DH_OWNER_UID");

// ======================================================
// SHARED HELPERS
// ======================================================

function dataOf(request) {
  return request.data && typeof request.data === "object"
    ? request.data
    : {};
}

function requireAuth(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Please sign in first.");
  }

  return request.auth;
}

function requireAdmin(request) {
  const auth = requireAuth(request);

  if (
    auth.token.admin !== true &&
    auth.token.superadmin !== true
  ) {
    throw new HttpsError(
      "permission-denied",
      "Administrator permission is required."
    );
  }

  return auth;
}

function requireSuperAdmin(request) {
  const auth = requireAuth(request);

  if (auth.token.superadmin !== true) {
    throw new HttpsError(
      "permission-denied",
      "Only the Super Admin can perform this operation."
    );
  }

  return auth;
}

function requireString(value, field, maxLength = 500) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.trim().length > maxLength
  ) {
    throw new HttpsError(
      "invalid-argument",
      `${field} is required and must not exceed ${maxLength} characters.`
    );
  }

  return value.trim();
}

function requireAmount(value, field = "Amount") {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount < 0) {
    throw new HttpsError(
      "invalid-argument",
      `${field} must be a valid non-negative amount.`
    );
  }

  return amount;
}

function getReason(data) {
  return typeof data.reason === "string"
    ? data.reason.trim().slice(0, 1000)
    : "";
}

async function getUserRecord(uid) {
  try {
    return await adminAuth.getUser(uid);
  } catch (error) {
    if (error.code === "auth/user-not-found") {
      throw new HttpsError("not-found", "Authentication account not found.");
    }

    throw error;
  }
}

async function requireUserProfile(uid) {
  const ref = db.collection("users").doc(uid);
  const snapshot = await ref.get();

  if (!snapshot.exists) {
    throw new HttpsError("not-found", "User profile not found.");
  }

  return {
    ref,
    data: snapshot.data()
  };
}

async function requireActiveUser(uid) {
  const user = await getUserRecord(uid);
  const { data } = await requireUserProfile(uid);

  if (!user.emailVerified) {
    throw new HttpsError(
      "failed-precondition",
      "The account email must be verified."
    );
  }

  if (data.status !== "active") {
    throw new HttpsError(
      "permission-denied",
      "The account is not active."
    );
  }

  return { user, profile: data };
}

async function writeAuditLog(
  actor,
  action,
  targetType,
  targetId,
  details = {}
) {
  await db.collection("auditLogs").add({
    actorUid: actor.uid,
    actorEmail: actor.token.email || null,
    actorRole: actor.token.superadmin === true
      ? "superadmin"
      : "admin",
    action,
    targetType,
    targetId,
    details,
    createdAt: FieldValue.serverTimestamp()
  });
}

async function updateUserStatus(
  actor,
  uid,
  status,
  action,
  reason = ""
) {
  const { ref } = await requireUserProfile(uid);

  await ref.update({
    status,
    updatedAt: FieldValue.serverTimestamp(),
    statusUpdatedAt: FieldValue.serverTimestamp(),
    statusUpdatedBy: actor.uid,
    statusReason: reason
  });

  await writeAuditLog(actor, action, "user", uid, {
    status,
    reason
  });

  return {
    success: true,
    message: `User account ${status}.`
  };
}

// ======================================================
// INITIAL SUPER ADMIN BOOTSTRAP
// Retained for compatibility with existing deployment.
// The owner.js bootstrap export below takes precedence.
// ======================================================

exports.bootstrapSuperAdmin = onCall(async (request) => {
  const auth = requireAuth(request);
  const configuredOwnerUid = OWNER_UID.value();

  if (!configuredOwnerUid) {
    throw new HttpsError(
      "failed-precondition",
      "The owner UID has not been configured."
    );
  }

  if (auth.uid !== configuredOwnerUid) {
    throw new HttpsError(
      "permission-denied",
      "This account is not authorised for initial setup."
    );
  }

  const user = await getUserRecord(auth.uid);

  if (!user.emailVerified) {
    throw new HttpsError(
      "failed-precondition",
      "Verify your email before setting up Super Admin."
    );
  }

  const lockRef = db.collection("system").doc("superAdminBootstrap");

  await db.runTransaction(async (transaction) => {
    const lock = await transaction.get(lockRef);

    if (lock.exists) {
      throw new HttpsError(
        "already-exists",
        "Super Admin bootstrap has already been reserved or completed."
      );
    }

    transaction.create(lockRef, {
      ownerUid: auth.uid,
      status: "initialising",
      createdAt: FieldValue.serverTimestamp()
    });
  });

  try {
    const existingClaims = user.customClaims || {};

    await adminAuth.setCustomUserClaims(auth.uid, {
      ...existingClaims,
      admin: true,
      superadmin: true
    });

    const userRef = db.collection("users").doc(auth.uid);
    const profile = await userRef.get();

    const profileData = {
      uid: auth.uid,
      email: user.email || auth.token.email || "",
      displayName: profile.exists
        ? profile.data().displayName || user.displayName || "Platform Owner"
        : user.displayName || "Platform Owner",
      role: "superadmin",
      status: "active",
      verificationStatus: "verified",
      updatedAt: FieldValue.serverTimestamp()
    };

    if (profile.exists) {
      await userRef.update(profileData);
    } else {
      await userRef.set({
        ...profileData,
        phone: user.phoneNumber || "",
        whatsapp: "",
        createdAt: FieldValue.serverTimestamp()
      });
    }

    await writeAuditLog(
      {
        uid: auth.uid,
        token: {
          email: user.email || null,
          superadmin: true
        }
      },
      "bootstrapSuperAdmin",
      "user",
      auth.uid,
      { description: "Initial Super Admin setup" }
    );

    await lockRef.update({
      status: "completed",
      completedAt: FieldValue.serverTimestamp()
    });

    return {
      success: true,
      message: "Initial Super Admin setup completed. Refresh your authentication token."
    };

  } catch (error) {
    console.error("Super Admin bootstrap failed:", error);

    await lockRef.update({
      status: "failed",
      failureRecordedAt: FieldValue.serverTimestamp(),
      failureCode: error.code || "unknown"
    }).catch((lockError) => {
      console.error("Could not update bootstrap lock:", lockError);
    });

    if (error instanceof HttpsError) throw error;

    throw new HttpsError(
      "internal",
      "Super Admin setup was interrupted. The bootstrap lock was preserved."
    );
  }
});

// ======================================================
// APPROVE USER
// ======================================================

exports.approveUser = onCall(async (request) => {
  const actor = requireAdmin(request);
  const data = dataOf(request);
  const uid = requireString(data.userId, "User ID");

  const user = await getUserRecord(uid);
  const { ref, data: profile } = await requireUserProfile(uid);

  if (!user.emailVerified) {
    throw new HttpsError(
      "failed-precondition",
      "The user must verify their email before approval."
    );
  }

  if (!["driver", "broker"].includes(profile.role)) {
    throw new HttpsError(
      "failed-precondition",
      "Only Driver and Broker accounts can be approved here."
    );
  }

  if (!["pending", "rejected"].includes(profile.status)) {
    throw new HttpsError(
      "failed-precondition",
      "This account is not awaiting approval."
    );
  }

  await ref.update({
    status: "active",
    approvedAt: FieldValue.serverTimestamp(),
    approvedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp()
  });

  await writeAuditLog(actor, "approveUser", "user", uid);

  return {
    success: true,
    message: "User account approved."
  };
});

// ======================================================
// REJECT USER
// ======================================================

exports.rejectUser = onCall(async (request) => {
  const actor = requireAdmin(request);
  const data = dataOf(request);
  const uid = requireString(data.userId, "User ID");
  const reason = getReason(data);

  const { ref, data: profile } = await requireUserProfile(uid);

  if (!["driver", "broker"].includes(profile.role)) {
    throw new HttpsError(
      "failed-precondition",
      "This operation is only for Driver and Broker accounts."
    );
  }

  await ref.update({
    status: "rejected",
    rejectionReason: reason,
    rejectedAt: FieldValue.serverTimestamp(),
    rejectedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp()
  });

  await writeAuditLog(actor, "rejectUser", "user", uid, { reason });

  return {
    success: true,
    message: "User application rejected."
  };
});

// ======================================================
// SUSPEND USER
// ======================================================

exports.suspendUser = onCall(async (request) => {
  const actor = requireAdmin(request);
  const data = dataOf(request);
  const uid = requireString(data.userId, "User ID");

  if (uid === actor.uid) {
    throw new HttpsError(
      "failed-precondition",
      "You cannot suspend your own account."
    );
  }

  const { data: profile } = await requireUserProfile(uid);
  const target = await getUserRecord(uid);

  const targetIsAdmin =
    target.customClaims?.admin === true ||
    target.customClaims?.superadmin === true;

  if (target.customClaims?.superadmin === true) {
    throw new HttpsError(
      "permission-denied",
      "A Super Admin cannot be suspended through this operation."
    );
  }

  if (targetIsAdmin && actor.token.superadmin !== true) {
    throw new HttpsError(
      "permission-denied",
      "Only the Super Admin can suspend another Admin."
    );
  }

  if (profile.status === "suspended") {
    throw new HttpsError(
      "failed-precondition",
      "This account is already suspended."
    );
  }

  return updateUserStatus(
    actor,
    uid,
    "suspended",
    "suspendUser",
    getReason(data)
  );
});

// ======================================================
// RESTORE USER
// ======================================================

exports.restoreUser = onCall(async (request) => {
  const actor = requireAdmin(request);
  const data = dataOf(request);
  const uid = requireString(data.userId, "User ID");

  const { data: profile } = await requireUserProfile(uid);
  const target = await getUserRecord(uid);

  if (!["driver", "broker", "admin"].includes(profile.role)) {
    throw new HttpsError(
      "failed-precondition",
      "This account cannot be restored through this operation."
    );
  }

  if (
    (target.customClaims?.admin === true ||
      target.customClaims?.superadmin === true) &&
    actor.token.superadmin !== true
  ) {
    throw new HttpsError(
      "permission-denied",
      "Only the Super Admin can restore an Admin account."
    );
  }

  if (!target.emailVerified) {
    throw new HttpsError(
      "failed-precondition",
      "The account email must be verified."
    );
  }

  return updateUserStatus(
    actor,
    uid,
    "active",
    "restoreUser",
    getReason(data)
  );
});

// ======================================================
// VERIFY DRIVER
// ======================================================

exports.verifyDriver = onCall(async (request) => {
  const actor = requireAdmin(request);
  const data = dataOf(request);
  const uid = requireString(data.driverId, "Driver ID");

  const { ref, data: profile } = await requireUserProfile(uid);

  if (profile.role !== "driver") {
    throw new HttpsError(
      "failed-precondition",
      "The selected account is not a driver."
    );
  }

  if (profile.status !== "active") {
    throw new HttpsError(
      "failed-precondition",
      "Only active drivers can be verified."
    );
  }

  await ref.update({
    verificationStatus: "verified",
    verifiedAt: FieldValue.serverTimestamp(),
    verifiedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp()
  });

  await writeAuditLog(actor, "verifyDriver", "user", uid);

  return {
    success: true,
    message: "Driver verification completed."
  };
});

// ======================================================
// REJECT DRIVER VERIFICATION
// ======================================================

exports.rejectDriverVerification = onCall(async (request) => {
  const actor = requireAdmin(request);
  const data = dataOf(request);
  const uid = requireString(data.driverId, "Driver ID");
  const reason = getReason(data);

  const { ref, data: profile } = await requireUserProfile(uid);

  if (profile.role !== "driver") {
    throw new HttpsError(
      "failed-precondition",
      "The selected account is not a driver."
    );
  }

  await ref.update({
    verificationStatus: "rejected",
    verificationReason: reason,
    verifiedAt: FieldValue.serverTimestamp(),
    verifiedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp()
  });

  await writeAuditLog(
    actor,
    "rejectDriverVerification",
    "user",
    uid,
    { reason }
  );

  return {
    success: true,
    message: "Driver verification rejected."
  };
});

// ======================================================
// REVIEW TRIP
// ======================================================

exports.reviewTrip = onCall(async (request) => {
  const actor = requireAdmin(request);
  const data = dataOf(request);

  const tripId = requireString(data.tripId, "Trip ID");
  const decision = requireString(data.decision, "Decision");

  if (!["approved", "rejected"].includes(decision)) {
    throw new HttpsError(
      "invalid-argument",
      "Decision must be approved or rejected."
    );
  }

  const ref = db.collection("trips").doc(tripId);
  const snapshot = await ref.get();

  if (!snapshot.exists) {
    throw new HttpsError("not-found", "Trip not found.");
  }

  if (snapshot.data().status !== "open") {
    throw new HttpsError(
      "failed-precondition",
      "Only open trips can be moderated."
    );
  }

  await ref.update({
    moderationStatus: decision,
    moderationReason: getReason(data),
    moderatedBy: actor.uid,
    moderatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

  await writeAuditLog(actor, "reviewTrip", "trip", tripId, {
    decision
  });

  return {
    success: true,
    message: `Trip ${decision}.`
  };
});

// ======================================================
// CREATE TRIP REQUEST
// ======================================================

exports.createTripRequest = onCall(async (request) => {
  const auth = requireAuth(request);
  const data = dataOf(request);

  const tripId = requireString(data.tripId, "Trip ID");
  const message = typeof data.message === "string"
    ? data.message.trim().slice(0, 1000)
    : "";

  const driverFare = data.offeredFare === undefined ||
    data.offeredFare === null
    ? null
    : requireAmount(data.offeredFare, "Offered fare");

  const { profile } = await requireActiveUser(auth.uid);

  if (profile.role !== "driver") {
    throw new HttpsError(
      "permission-denied",
      "Only active drivers can request trips."
    );
  }

  if (profile.verificationStatus !== "verified") {
    throw new HttpsError(
      "permission-denied",
      "Your driver profile must be verified before requesting trips."
    );
  }

  const tripRef = db.collection("trips").doc(tripId);
  const requestRef = db.collection("tripRequests").doc();

  await db.runTransaction(async (transaction) => {
    const tripSnapshot = await transaction.get(tripRef);

    if (!tripSnapshot.exists) {
      throw new HttpsError("not-found", "Trip not found.");
    }

    const trip = tripSnapshot.data();

    if (
      trip.status !== "open" ||
      trip.moderationStatus !== "approved"
    ) {
      throw new HttpsError(
        "failed-precondition",
        "This trip is not currently accepting requests."
      );
    }

    if (trip.posterUid === auth.uid) {
      throw new HttpsError(
        "failed-precondition",
        "You cannot request your own trip."
      );
    }

    transaction.create(requestRef, {
      tripId,
      posterUid: trip.posterUid,
      driverUid: auth.uid,
      driverName: profile.displayName || "",
      message,
      offeredFare: driverFare,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
  });

  await writeAuditLog(
    {
      uid: auth.uid,
      token: { email: auth.token.email || null }
    },
    "createTripRequest",
    "tripRequest",
    requestRef.id,
    { tripId }
  );

  return {
    success: true,
    requestId: requestRef.id,
    message: "Trip request submitted."
  };
});

// ======================================================
// ASSIGN DRIVER
// ======================================================

exports.assignDriver = onCall(async (request) => {
  const auth = requireAuth(request);
  const data = dataOf(request);

  const tripId = requireString(data.tripId, "Trip ID");
  const requestId = requireString(data.requestId, "Request ID");

  const tripRef = db.collection("trips").doc(tripId);
  const requestRef = db.collection("tripRequests").doc(requestId);
  const paymentRef = db.collection("paymentRecords").doc(tripId);

  let assignedDriverUid = "";

  await db.runTransaction(async (transaction) => {
    const tripSnapshot = await transaction.get(tripRef);
    const requestSnapshot = await transaction.get(requestRef);

    if (!tripSnapshot.exists || !requestSnapshot.exists) {
      throw new HttpsError(
        "not-found",
        "Trip or trip request not found."
      );
    }

    const trip = tripSnapshot.data();
    const tripRequest = requestSnapshot.data();

    const isPoster = trip.posterUid === auth.uid;
    const isAdmin = auth.token.admin === true ||
      auth.token.superadmin === true;

    if (!isPoster && !isAdmin) {
      throw new HttpsError(
        "permission-denied",
        "Only the trip poster or an Admin can assign a driver."
      );
    }

    if (tripRequest.tripId !== tripId) {
      throw new HttpsError(
        "invalid-argument",
        "The request does not belong to this trip."
      );
    }

    if (trip.status !== "open" || trip.moderationStatus !== "approved") {
      throw new HttpsError(
        "failed-precondition",
        "This trip is not available for assignment."
      );
    }

    if (tripRequest.status !== "pending") {
      throw new HttpsError(
        "failed-precondition",
        "This driver request is no longer pending."
      );
    }

    const driverUid = tripRequest.driverUid;
    const driverRef = db.collection("users").doc(driverUid);
    const driverSnapshot = await transaction.get(driverRef);

    if (!driverSnapshot.exists) {
      throw new HttpsError("not-found", "Driver profile not found.");
    }

    const driver = driverSnapshot.data();

    if (
      driver.role !== "driver" ||
      driver.status !== "active" ||
      driver.verificationStatus !== "verified"
    ) {
      throw new HttpsError(
        "failed-precondition",
        "The selected driver is not active and verified."
      );
    }

    assignedDriverUid = driverUid;

    transaction.update(tripRef, {
      status: "assigned",
      assignedDriverUid: driverUid,
      assignedDriverName: driver.displayName || "",
      assignedRequestId: requestId,
      assignedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });

    transaction.update(requestRef, {
      status: "accepted",
      respondedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });

    transaction.set(paymentRef, {
      tripId,
      posterUid: trip.posterUid,
      driverUid,
      agreedFare: tripRequest.offeredFare !== null &&
        tripRequest.offeredFare !== undefined
        ? tripRequest.offeredFare
        : trip.fare,
      amountPaid: 0,
      paymentStatus: "unpaid",
      paymentMethod: null,
      paymentDate: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
  });

  await writeAuditLog(
    {
      uid: auth.uid,
      token: {
        email: auth.token.email || null,
        admin: auth.token.admin === true,
        superadmin: auth.token.superadmin === true
      }
    },
    "assignDriver",
    "trip",
    tripId,
    { requestId, assignedDriverUid }
  );

  return {
    success: true,
    message: "Driver assigned successfully.",
    driverUid: assignedDriverUid
  };
});

// ======================================================
// CONFIRM TRIP COMPLETION
// ======================================================

exports.confirmTripCompletion = onCall(async (request) => {
  const auth = requireAuth(request);
  const data = dataOf(request);
  const tripId = requireString(data.tripId, "Trip ID");

  const tripRef = db.collection("trips").doc(tripId);

  let completed = false;

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(tripRef);

    if (!snapshot.exists) {
      throw new HttpsError("not-found", "Trip not found.");
    }

    const trip = snapshot.data();

    if (trip.status !== "assigned" && trip.status !== "in_progress") {
      throw new HttpsError(
        "failed-precondition",
        "Only assigned or in-progress trips can be confirmed."
      );
    }

    const isPoster = trip.posterUid === auth.uid;
    const isDriver = trip.assignedDriverUid === auth.uid;

    if (!isPoster && !isDriver) {
      throw new HttpsError(
        "permission-denied",
        "You are not a participant in this trip."
      );
    }

    if (isPoster && trip.posterConfirmedCompletion === true) {
      throw new HttpsError(
        "already-exists",
        "The trip poster has already confirmed completion."
      );
    }

    if (isDriver && trip.driverConfirmedCompletion === true) {
      throw new HttpsError(
        "already-exists",
        "The driver has already confirmed completion."
      );
    }

    const updates = {
      updatedAt: FieldValue.serverTimestamp()
    };

    if (isPoster) {
      updates.posterConfirmedCompletion = true;
      updates.posterCompletionConfirmedAt = FieldValue.serverTimestamp();
    }

    if (isDriver) {
      updates.driverConfirmedCompletion = true;
      updates.driverCompletionConfirmedAt = FieldValue.serverTimestamp();
    }

    const posterAlreadyConfirmed =
      isPoster || trip.posterConfirmedCompletion === true;

    const driverAlreadyConfirmed =
      isDriver || trip.driverConfirmedCompletion === true;

    if (posterAlreadyConfirmed && driverAlreadyConfirmed) {
      updates.status = "completed";
      updates.completedAt = FieldValue.serverTimestamp();
      completed = true;
    }

    transaction.update(tripRef, updates);
  });

  await writeAuditLog(
    {
      uid: auth.uid,
      token: {
        email: auth.token.email || null
      }
    },
    "confirmTripCompletion",
    "trip",
    tripId,
    { completed }
  );

  return {
    success: true,
    completed,
    message: completed
      ? "Both parties have confirmed. The trip is completed."
      : "Your confirmation has been recorded. Waiting for the other party."
  };
});

// ======================================================
// ARCHIVE COMPLETED TRIP
// ======================================================

exports.archiveTrip = onCall(async (request) => {
  const actor = requireAdmin(request);
  const data = dataOf(request);
  const tripId = requireString(data.tripId, "Trip ID");

  const ref = db.collection("trips").doc(tripId);
  const snapshot = await ref.get();

  if (!snapshot.exists) {
    throw new HttpsError("not-found", "Trip not found.");
  }

  if (snapshot.data().status !== "completed") {
    throw new HttpsError(
      "failed-precondition",
      "Only completed trips can be archived."
    );
  }

  await ref.update({
    status: "archived",
    archivedAt: FieldValue.serverTimestamp(),
    archivedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp()
  });

  await writeAuditLog(actor, "archiveTrip", "trip", tripId);

  return {
    success: true,
    message: "Completed trip archived."
  };
});

// ======================================================
// RESTORE ARCHIVED TRIP
// ======================================================

exports.restoreTrip = onCall(async (request) => {
  const actor = requireAdmin(request);
  const data = dataOf(request);
  const tripId = requireString(data.tripId, "Trip ID");

  const ref = db.collection("trips").doc(tripId);
  const snapshot = await ref.get();

  if (!snapshot.exists) {
    throw new HttpsError("not-found", "Trip not found.");
  }

  if (snapshot.data().status !== "archived") {
    throw new HttpsError(
      "failed-precondition",
      "Only archived trips can be restored."
    );
  }

  await ref.update({
    status: "completed",
    restoredAt: FieldValue.serverTimestamp(),
    restoredBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp()
  });

  await writeAuditLog(actor, "restoreTrip", "trip", tripId);

  return {
    success: true,
    message: "Trip restored."
  };
});

// ======================================================
// SUPER ADMIN PERMANENT DELETION
// ======================================================

exports.permanentlyDeleteCompletedTrip = onCall(async (request) => {
  const actor = requireSuperAdmin(request);
  const data = dataOf(request);

  const tripId = requireString(data.tripId, "Trip ID");

  if (data.confirm !== true) {
    throw new HttpsError(
      "failed-precondition",
      "Explicit confirmation is required."
    );
  }

  const tripRef = db.collection("trips").doc(tripId);

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(tripRef);

    if (!snapshot.exists) {
      throw new HttpsError("not-found", "Trip not found.");
    }

    const trip = snapshot.data();

    if (!["completed", "archived"].includes(trip.status)) {
      throw new HttpsError(
        "failed-precondition",
        "Only completed or archived trips can be permanently deleted."
      );
    }

    transaction.delete(tripRef);
  });

  await writeAuditLog(
    actor,
    "permanentlyDeleteCompletedTrip",
    "trip",
    tripId,
    {
      warning: "Trip document permanently deleted. Related payment and audit records retained."
    }
  );

  return {
    success: true,
    message: "Completed trip permanently deleted. Payment and audit records were retained."
  };
});

// ======================================================
// UPDATE PAYMENT RECORD
// ======================================================

exports.updatePaymentRecord = onCall(async (request) => {
  const actor = requireAdmin(request);
  const data = dataOf(request);

  const paymentId = requireString(data.paymentId, "Payment ID");
  const paymentStatus = requireString(data.paymentStatus, "Payment status");

  const allowedStatuses = [
    "unpaid",
    "partially_paid",
    "paid",
    "disputed"
  ];

  if (!allowedStatuses.includes(paymentStatus)) {
    throw new HttpsError(
      "invalid-argument",
      "Invalid payment status."
    );
  }

  const ref = db.collection("paymentRecords").doc(paymentId);
  const snapshot = await ref.get();

  if (!snapshot.exists) {
    throw new HttpsError("not-found", "Payment record not found.");
  }

  const payment = snapshot.data();

  const updates = {
    paymentStatus,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor.uid,
    adminReason: getReason(data)
  };

  if (data.amountPaid !== undefined) {
    const amountPaid = requireAmount(data.amountPaid, "Amount paid");

    if (
      payment.agreedFare !== undefined &&
      amountPaid > Number(payment.agreedFare)
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Amount paid cannot exceed the agreed fare."
      );
    }

    updates.amountPaid = amountPaid;
  }

  await ref.update(updates);

  await writeAuditLog(
    actor,
    "updatePaymentRecord",
    "payment",
    paymentId,
    {
      paymentStatus,
      amountPaid: updates.amountPaid ?? null
    }
  );

  return {
    success: true,
    message: "Payment record updated."
  };
});

// ======================================================
// REVIEW COMPLAINT
// ======================================================

exports.reviewComplaint = onCall(async (request) => {
  const actor = requireAdmin(request);
  const data = dataOf(request);

  const complaintId = requireString(data.complaintId, "Complaint ID");
  const status = requireString(data.status, "Complaint status");

  const allowedStatuses = [
    "under_review",
    "resolved",
    "dismissed"
  ];

  if (!allowedStatuses.includes(status)) {
    throw new HttpsError(
      "invalid-argument",
      "Invalid complaint status."
    );
  }

  const ref = db.collection("complaints").doc(complaintId);
  const snapshot = await ref.get();

  if (!snapshot.exists) {
    throw new HttpsError("not-found", "Complaint not found.");
  }

  await ref.update({
    status,
    adminNotes: getReason(data),
    reviewedBy: actor.uid,
    reviewedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

  await writeAuditLog(actor, "reviewComplaint", "complaint", complaintId, {
    status
  });

  return {
    success: true,
    message: "Complaint reviewed."
  };
});

// ======================================================
// PUBLISH ANNOUNCEMENT
// ======================================================

exports.publishAnnouncement = onCall(async (request) => {
  const actor = requireAdmin(request);
  const data = dataOf(request);

  const announcement = requireString(
    data.announcement,
    "Announcement",
    2000
  );

  const ref = await db.collection("announcements").add({
    message: announcement,
    publishedBy: actor.uid,
    publishedAt: FieldValue.serverTimestamp(),
    active: true
  });

  await writeAuditLog(
    actor,
    "publishAnnouncement",
    "announcement",
    ref.id
  );

  return {
    success: true,
    message: "Announcement published.",
    announcementId: ref.id
  };
});

// ======================================================
// GRANT OR REVOKE ADMIN ACCESS
// SUPER ADMIN ONLY
// ======================================================

exports.manageAdminAccess = onCall(async (request) => {
  const actor = requireSuperAdmin(request);
  const data = dataOf(request);

  const targetUid = requireString(data.targetUid, "Target user ID");
  const action = requireString(data.action, "Action");

  if (!["grant", "revoke"].includes(action)) {
    throw new HttpsError(
      "invalid-argument",
      "Action must be grant or revoke."
    );
  }

  if (targetUid === actor.uid) {
    throw new HttpsError(
      "failed-precondition",
      "You cannot change your own Super Admin access."
    );
  }

  const targetUser = await getUserRecord(targetUid);
  const { ref, data: profile } = await requireUserProfile(targetUid);

  if (
    profile.role === "superadmin" ||
    targetUser.customClaims?.superadmin === true
  ) {
    throw new HttpsError(
      "permission-denied",
      "This operation cannot change another Super Admin."
    );
  }

  if (action === "grant") {
    if (!targetUser.emailVerified || profile.status !== "active") {
      throw new HttpsError(
        "failed-precondition",
        "Only verified, active accounts can receive Admin access."
      );
    }

    if (!["driver", "broker"].includes(profile.role)) {
      throw new HttpsError(
        "failed-precondition",
        "This account cannot be granted Admin access."
      );
    }

    const existingClaims = targetUser.customClaims || {};

    await adminAuth.setCustomUserClaims(targetUid, {
      ...existingClaims,
      admin: true
    });

    await ref.update({
      adminAccessOriginalRole: profile.role,
      role: "admin",
      updatedAt: FieldValue.serverTimestamp()
    });

  } else {
    if (targetUser.customClaims?.admin !== true) {
      throw new HttpsError(
        "failed-precondition",
        "This account does not currently have Admin access."
      );
    }

    const existingClaims = targetUser.customClaims || {};
    const updatedClaims = { ...existingClaims };

    delete updatedClaims.admin;

    const originalRole = profile.adminAccessOriginalRole;

    if (!["driver", "broker"].includes(originalRole)) {
      throw new HttpsError(
        "failed-precondition",
        "The original account role is missing. Manual review is required."
      );
    }

    await adminAuth.setCustomUserClaims(targetUid, updatedClaims);

    await ref.update({
      role: originalRole,
      adminAccessOriginalRole: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp()
    });
  }

  await writeAuditLog(
    actor,
    "manageAdminAccess",
    "user",
    targetUid,
    { action }
  );

  return {
    success: true,
    message: action === "grant"
      ? "Administrator access granted."
      : "Administrator access revoked."
  };
});

// ======================================================
// OWNER AND ADDITIONAL SUPER ADMIN FUNCTIONS
// These exports replace the old bootstrap implementation.
// ======================================================

exports.bootstrapSuperAdmin =
  ownerFunctions.bootstrapSuperAdmin;

exports.addSuperAdminByEmail =
  ownerFunctions.addSuperAdminByEmail;

exports.revokeSuperAdminByEmail =
  ownerFunctions.revokeSuperAdminByEmail;

exports.listAdditionalSuperAdmins =
  ownerFunctions.listAdditionalSuperAdmins;
