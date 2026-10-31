
"use strict";

// ======================================================
// DARJEELINGHOST V1 - TRUSTED FIREBASE BACKEND
// ======================================================

const { initializeApp } = require("firebase-admin/app");

const {
  getAuth
} = require("firebase-admin/auth");

const {
  getFirestore,
  FieldValue
} = require("firebase-admin/firestore");

const {
  onCall,
  HttpsError
} = require("firebase-functions/v2/https");

const {
  defineString
} = require("firebase-functions/params");

const { setGlobalOptions } = require("firebase-functions/v2");

// ======================================================
// INITIALISATION
// ======================================================

initializeApp();

const db = getFirestore();
const adminAuth = getAuth();

setGlobalOptions({
  region: "asia-south1",
  maxInstances: 10
});

// Configure this with your actual Firebase Authentication UID.
const OWNER_UID = defineString("DH_OWNER_UID");

// ======================================================
// SHARED HELPERS
// ======================================================

function requireAuth(request) {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "Please sign in first."
    );
  }

  return request.auth;
}

function requireAdmin(request) {
  const auth = requireAuth(request);
  const claims = auth.token || {};

  if (
    claims.admin !== true &&
    claims.superadmin !== true
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

function requireString(value, field) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new HttpsError(
      "invalid-argument",
      `${field} is required.`
    );
  }

  return value.trim();
}

function requireAmount(value) {
  const amount = Number(value);

  if (
    !Number.isFinite(amount) ||
    amount < 0
  ) {
    throw new HttpsError(
      "invalid-argument",
      "A valid non-negative amount is required."
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
    throw new HttpsError(
      "not-found",
      "The requested authentication account was not found."
    );
  }
}

async function requireUserProfile(uid) {
  const ref = db.collection("users").doc(uid);
  const snapshot = await ref.get();

  if (!snapshot.exists) {
    throw new HttpsError(
      "not-found",
      "User profile not found."
    );
  }

  return {
    ref,
    data: snapshot.data()
  };
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

  await writeAuditLog(
    actor,
    action,
    "user",
    uid,
    { status, reason }
  );

  return {
    success: true,
    message: `User account ${status}.`
  };
}

// ======================================================
// FIRST SUPER ADMIN BOOTSTRAP
// ======================================================

// This function is restricted to the exact UID configured
// through DH_OWNER_UID. It can succeed only once.
//
// The owner must have a verified Firebase Auth email.
// Do not put a service-account key or bootstrap password
// in this repository.

exports.bootstrapSuperAdmin = onCall(
  async (request) => {
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

    if (auth.token.email_verified !== true) {
      throw new HttpsError(
        "failed-precondition",
        "Verify your email address before setting up Super Admin."
      );
    }

    const lockRef = db.collection("system").doc(
      "superAdminBootstrap"
    );

    // Atomically reserve the one-time bootstrap.
    await db.runTransaction(async (transaction) => {
      const lock = await transaction.get(lockRef);

      if (lock.exists) {
        throw new HttpsError(
          "already-exists",
          "The initial Super Admin setup has already been used."
        );
      }

      transaction.create(lockRef, {
        ownerUid: auth.uid,
        status: "initialising",
        createdAt: FieldValue.serverTimestamp()
      });
    });

    try {
      const user = await getUserRecord(auth.uid);

      if (!user.emailVerified) {
        throw new HttpsError(
          "failed-precondition",
          "The Firebase Authentication email must be verified."
        );
      }

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
        displayName:
          profile.exists
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

      await db.collection("auditLogs").add({
        actorUid: auth.uid,
        actorEmail: user.email || null,
        actorRole: "superadmin",
        action: "bootstrapSuperAdmin",
        targetType: "user",
        targetId: auth.uid,
        details: {
          description: "Initial Super Admin setup"
        },
        createdAt: FieldValue.serverTimestamp()
      });

      await lockRef.update({
        status: "completed",
        completedAt: FieldValue.serverTimestamp()
      });

      return {
        success: true,
        message: "Initial Super Admin setup completed."
      };

    } catch (error) {
      // Release the reservation if setup failed.
      // A successful setup leaves the lock permanently in place.
      await lockRef.delete().catch(() => {});

      console.error("Super Admin bootstrap failed:", error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError(
        "internal",
        "Super Admin setup could not be completed."
      );
    }
  }
);

// ======================================================
// APPROVE USER
// ======================================================

exports.approveUser = onCall(async (request) => {
  const actor = requireAdmin(request);
  const uid = requireString(request.data.userId, "User ID");

  const { ref, data } = await requireUserProfile(uid);

  if (!["driver", "broker"].includes(data.role)) {
    throw new HttpsError(
      "failed-precondition",
      "Only driver and broker accounts can be approved here."
    );
  }

  await ref.update({
    status: "active",
    approvedAt: FieldValue.serverTimestamp(),
    approvedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp()
  });

  await writeAuditLog(
    actor,
    "approveUser",
    "user",
    uid
  );

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
  const uid = requireString(request.data.userId, "User ID");

  const reason = getReason(request.data);

  const { ref } = await requireUserProfile(uid);

  await ref.update({
    status: "rejected",
    rejectionReason: reason,
    rejectedAt: FieldValue.serverTimestamp(),
    rejectedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp()
  });

  await writeAuditLog(
    actor,
    "rejectUser",
    "user",
    uid,
    { reason }
  );

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
  const uid = requireString(request.data.userId, "User ID");

  if (uid === actor.uid) {
    throw new HttpsError(
      "failed-precondition",
      "You cannot suspend your own account."
    );
  }

  const { data } = await requireUserProfile(uid);

  if (
    data.role === "superadmin" ||
    (await getUserRecord(uid)).customClaims?.superadmin === true
  ) {
    throw new HttpsError(
      "permission-denied",
      "A Super Admin account cannot be suspended through this operation."
    );
  }

  return updateUserStatus(
    actor,
    uid,
    "suspended",
    "suspendUser",
    getReason(request.data)
  );
});

// ======================================================
// RESTORE USER
// ======================================================

exports.restoreUser = onCall(async (request) => {
  const actor = requireAdmin(request);
  const uid = requireString(request.data.userId, "User ID");

  const { data } = await requireUserProfile(uid);

  if (!["driver", "broker"].includes(data.role)) {
    throw new HttpsError(
      "failed-precondition",
      "This operation is only for driver or broker accounts."
    );
  }

  return updateUserStatus(
    actor,
    uid,
    "active",
    "restoreUser",
    getReason(request.data)
  );
});

// ======================================================
// VERIFY DRIVER
// ======================================================

exports.verifyDriver = onCall(async (request) => {
  const actor = requireAdmin(request);
  const uid = requireString(request.data.driverId, "Driver ID");

  const { ref, data } = await requireUserProfile(uid);

  if (data.role !== "driver") {
    throw new HttpsError(
      "failed-precondition",
      "The selected account is not a driver."
    );
  }

  await ref.update({
    verificationStatus: "verified",
    verifiedAt: FieldValue.serverTimestamp(),
    verifiedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp()
  });

  await writeAuditLog(
    actor,
    "verifyDriver",
    "user",
    uid
  );

  return {
    success: true,
    message: "Driver verification completed."
  };
});

// ======================================================
// REJECT DRIVER VERIFICATION
// ======================================================

exports.rejectDriverVerification = onCall(
  async (request) => {
    const actor = requireAdmin(request);
    const uid = requireString(
      request.data.driverId,
      "Driver ID"
    );

    const reason = getReason(request.data);

    const { ref, data } = await requireUserProfile(uid);

    if (data.role !== "driver") {
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
  }
);

// ======================================================
// REVIEW TRIP
// ======================================================

exports.reviewTrip = onCall(async (request) => {
  const actor = requireAdmin(request);

  const tripId = requireString(
    request.data.tripId,
    "Trip ID"
  );

  const decision = requireString(
    request.data.decision,
    "Decision"
  );

  if (!["approved", "rejected"].includes(decision)) {
    throw new HttpsError(
      "invalid-argument",
      "Decision must be approved or rejected."
    );
  }

  const ref = db.collection("trips").doc(tripId);
  const snapshot = await ref.get();

  if (!snapshot.exists) {
    throw new HttpsError(
      "not-found",
      "Trip not found."
    );
  }

  await ref.update({
    moderationStatus: decision,
    moderationReason: getReason(request.data),
    moderatedBy: actor.uid,
    moderatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

  await writeAuditLog(
    actor,
    "reviewTrip",
    "trip",
    tripId,
    { decision }
  );

  return {
    success: true,
    message: `Trip ${decision}.`
  };
});

// ======================================================
// ARCHIVE COMPLETED TRIP
// ======================================================

exports.archiveTrip = onCall(async (request) => {
  const actor = requireAdmin(request);

  const tripId = requireString(
    request.data.tripId,
    "Trip ID"
  );

  const ref = db.collection("trips").doc(tripId);
  const snapshot = await ref.get();

  if (!snapshot.exists) {
    throw new HttpsError(
      "not-found",
      "Trip not found."
    );
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

  await writeAuditLog(
    actor,
    "archiveTrip",
    "trip",
    tripId
  );

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

  const tripId = requireString(
    request.data.tripId,
    "Trip ID"
  );

  const ref = db.collection("trips").doc(tripId);
  const snapshot = await ref.get();

  if (!snapshot.exists) {
    throw new HttpsError(
      "not-found",
      "Trip not found."
    );
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

  await writeAuditLog(
    actor,
    "restoreTrip",
    "trip",
    tripId
  );

  return {
    success: true,
    message: "Trip restored."
  };
});

// ======================================================
// UPDATE PAYMENT RECORD
// ======================================================

exports.updatePaymentRecord = onCall(
  async (request) => {
    const actor = requireAdmin(request);

    const paymentId = requireString(
      request.data.paymentId,
      "Payment ID"
    );

    const paymentStatus = requireString(
      request.data.paymentStatus,
      "Payment status"
    );

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
      throw new HttpsError(
        "not-found",
        "Payment record not found."
      );
    }

    const data = snapshot.data();

    const updates = {
      paymentStatus,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
      adminReason: getReason(request.data)
    };

    if (request.data.amountPaid !== undefined) {
      const amountPaid = requireAmount(
        request.data.amountPaid
      );

      if (
        data.agreedFare !== undefined &&
        amountPaid > Number(data.agreedFare)
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
  }
);

// ======================================================
// REVIEW COMPLAINT
// ======================================================

exports.reviewComplaint = onCall(async (request) => {
  const actor = requireAdmin(request);

  const complaintId = requireString(
    request.data.complaintId,
    "Complaint ID"
  );

  const status = requireString(
    request.data.status,
    "Complaint status"
  );

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
    throw new HttpsError(
      "not-found",
      "Complaint not found."
    );
  }

  await ref.update({
    status,
    adminNotes: getReason(request.data),
    reviewedBy: actor.uid,
    reviewedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

  await writeAuditLog(
    actor,
    "reviewComplaint",
    "complaint",
    complaintId,
    { status }
  );

  return {
    success: true,
    message: "Complaint reviewed."
  };
});

// ======================================================
// PUBLISH ANNOUNCEMENT
// ======================================================

exports.publishAnnouncement = onCall(
  async (request) => {
    const actor = requireAdmin(request);

    const announcement = requireString(
      request.data.announcement,
      "Announcement"
    );

    if (announcement.length > 2000) {
      throw new HttpsError(
        "invalid-argument",
        "Announcement must not exceed 2000 characters."
      );
    }

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
  }
);

// ======================================================
// GRANT OR REVOKE ADMIN ACCESS
// SUPER ADMIN ONLY
// ======================================================

exports.manageAdminAccess = onCall(
  async (request) => {
    const actor = requireSuperAdmin(request);

    const targetUid = requireString(
      request.data.targetUid,
      "Target user ID"
    );

    const action = requireString(
      request.data.action,
      "Action"
    );

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
    const { ref, data } = await requireUserProfile(targetUid);

    if (data.role === "superadmin") {
      throw new HttpsError(
        "permission-denied",
        "This operation cannot change another Super Admin."
      );
    }

    if (action === "grant") {
      if (data.status !== "active") {
        throw new HttpsError(
          "failed-precondition",
          "Only active accounts can receive Admin access."
        );
      }

      const existingClaims = targetUser.customClaims || {};

      await adminAuth.setCustomUserClaims(targetUid, {
        ...existingClaims,
        admin: true
      });

      await ref.update({
        role: "admin",
        updatedAt: FieldValue.serverTimestamp()
      });

    } else {
      const existingClaims = targetUser.customClaims || {};
      const updatedClaims = { ...existingClaims };

      delete updatedClaims.admin;

      await adminAuth.setCustomUserClaims(
        targetUid,
        updatedClaims
      );

      await ref.update({
        role: data.role === "admin" ? "driver" : data.role,
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
  }
);
