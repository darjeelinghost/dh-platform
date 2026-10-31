
"use strict";

// ======================================================
// DARJEELINGHOST V1
// PRIMARY OWNER & SUPER ADMIN MANAGEMENT
// Firebase Functions v2 + Firebase Admin SDK
// ======================================================

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

// ======================================================
// CONFIGURATION
// ======================================================

const REGION = "asia-south1";
const OWNER_EMAIL = "darjeelinghost@gmail.com";

// Must match the DH_OWNER_UID parameter used by the project.
const OWNER_UID = defineString("DH_OWNER_UID");

const auth = getAuth();
const db = getFirestore();

// ======================================================
// AUTHENTICATION AND OWNER SECURITY
// ======================================================

function requireSignedIn(request) {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "Please sign in first."
    );
  }

  return request.auth;
}

function requirePrimaryOwner(request) {
  const caller = requireSignedIn(request);
  const configuredUid = OWNER_UID.value();

  if (!configuredUid) {
    throw new HttpsError(
      "failed-precondition",
      "The primary owner UID has not been configured."
    );
  }

  if (caller.uid !== configuredUid) {
    throw new HttpsError(
      "permission-denied",
      "Only the registered primary owner can perform this operation."
    );
  }

  const callerEmail = String(
    caller.token.email || ""
  ).trim().toLowerCase();

  if (callerEmail !== OWNER_EMAIL) {
    throw new HttpsError(
      "permission-denied",
      "The signed-in account does not match the primary owner email."
    );
  }

  if (caller.token.email_verified !== true) {
    throw new HttpsError(
      "failed-precondition",
      "The primary owner's email must be verified."
    );
  }

  return caller;
}

// ======================================================
// INPUT VALIDATION
// ======================================================

function validateEmail(value) {
  if (typeof value !== "string") {
    throw new HttpsError(
      "invalid-argument",
      "An email address is required."
    );
  }

  const email = value.trim().toLowerCase();

  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Enter a valid email address."
    );
  }

  return email;
}

// ======================================================
// AUDIT LOGGING
// ======================================================

async function recordOwnerAction(
  owner,
  action,
  targetUid,
  targetEmail,
  details = {}
) {
  await db.collection("auditLogs").add({
    actorUid: owner.uid,
    actorEmail: OWNER_EMAIL,
    actorRole: "primary_owner",
    action,
    targetType: "user",
    targetId: targetUid,
    targetEmail,
    details,
    createdAt: FieldValue.serverTimestamp()
  });
}

// ======================================================
// PRIMARY OWNER BOOTSTRAP / RECOVERY
// ======================================================

exports.bootstrapSuperAdmin = onCall(
  { region: REGION },
  async (request) => {
    const owner = requirePrimaryOwner(request);

    const ownerRecord = await auth.getUser(owner.uid);

    if (
      ownerRecord.email.toLowerCase() !== OWNER_EMAIL ||
      !ownerRecord.emailVerified
    ) {
      throw new HttpsError(
        "failed-precondition",
        "The primary owner account must have the correct verified email."
      );
    }

    const lockRef = db
      .collection("system")
      .doc("superAdminBootstrap");

    const profileRef = db
      .collection("users")
      .doc(owner.uid);

    // Reserve the owner identity transactionally.
    // A retry is permitted only for the same configured UID.
    await db.runTransaction(async (transaction) => {
      const lock = await transaction.get(lockRef);

      if (lock.exists) {
        const existing = lock.data() || {};

        if (
          existing.ownerUid &&
          existing.ownerUid !== owner.uid
        ) {
          throw new HttpsError(
            "permission-denied",
            "The bootstrap record belongs to another owner UID."
          );
        }

        if (
          existing.ownerEmail &&
          existing.ownerEmail.toLowerCase() !== OWNER_EMAIL
        ) {
          throw new HttpsError(
            "permission-denied",
            "The bootstrap record has a different owner email."
          );
        }

        transaction.set(lockRef, {
          ownerUid: owner.uid,
          ownerEmail: OWNER_EMAIL,
          status: "initialising",
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });

      } else {
        transaction.create(lockRef, {
          ownerUid: owner.uid,
          ownerEmail: OWNER_EMAIL,
          status: "initialising",
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        });
      }
    });

    try {
      const existingClaims = ownerRecord.customClaims || {};

      // Preserve existing custom claims.
      await auth.setCustomUserClaims(owner.uid, {
        ...existingClaims,
        admin: true,
        superadmin: true,
        primaryOwner: true
      });

      const profileSnapshot = await profileRef.get();

      const profileData = {
        uid: owner.uid,
        email: OWNER_EMAIL,
        displayName:
          ownerRecord.displayName || "DarjeelingHost Owner",
        role: "superadmin",
        ownerAccount: true,
        status: "active",
        verificationStatus: "verified",
        updatedAt: FieldValue.serverTimestamp()
      };

      if (profileSnapshot.exists) {
        await profileRef.set(profileData, { merge: true });
      } else {
        await profileRef.set({
          ...profileData,
          phone: ownerRecord.phoneNumber || "",
          whatsapp: "",
          createdAt: FieldValue.serverTimestamp()
        });
      }

      await recordOwnerAction(
        owner,
        "bootstrapSuperAdmin",
        owner.uid,
        OWNER_EMAIL,
        {
          description:
            "Primary owner access initialised or recovered."
        }
      );

      await lockRef.set({
        ownerUid: owner.uid,
        ownerEmail: OWNER_EMAIL,
        status: "completed",
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      return {
        success: true,
        message:
          "Primary owner access is ready. Sign out and sign in again to refresh permissions."
      };

    } catch (error) {
      console.error("Owner bootstrap failed:", error);

      await lockRef.set({
        ownerUid: owner.uid,
        ownerEmail: OWNER_EMAIL,
        status: "failed",
        failureCode: error.code || "unknown",
        failureRecordedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true }).catch((lockError) => {
        console.error(
          "Could not update owner bootstrap record:",
          lockError
        );
      });

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError(
        "internal",
        "Owner setup failed. The owner record has been preserved for safe recovery."
      );
    }
  }
);

// ======================================================
// ADD ADDITIONAL SUPER ADMIN BY EMAIL
// PRIMARY OWNER ONLY
// ======================================================

exports.addSuperAdminByEmail = onCall(
  { region: REGION },
  async (request) => {
    const owner = requirePrimaryOwner(request);
    const email = validateEmail(request.data?.email);

    if (email === OWNER_EMAIL) {
      throw new HttpsError(
        "failed-precondition",
        "The primary owner is already a Super Admin."
      );
    }

    let target;

    try {
      target = await auth.getUserByEmail(email);
    } catch (error) {
      if (error.code === "auth/user-not-found") {
        throw new HttpsError(
          "not-found",
          "This email does not have a registered DarjeelingHost account. Ask the person to register first."
        );
      }

      throw error;
    }

    if (!target.emailVerified) {
      throw new HttpsError(
        "failed-precondition",
        "The account email must be verified first."
      );
    }

    const targetRef = db.collection("users").doc(target.uid);
    const targetSnapshot = await targetRef.get();

    if (!targetSnapshot.exists) {
      throw new HttpsError(
        "failed-precondition",
        "The account does not have a DarjeelingHost user profile."
      );
    }

    const profile = targetSnapshot.data();

    if (profile.status !== "active") {
      throw new HttpsError(
        "failed-precondition",
        "Only active accounts can receive Super Admin access."
      );
    }

    if (
      profile.ownerAccount === true ||
      target.customClaims?.primaryOwner === true
    ) {
      throw new HttpsError(
        "permission-denied",
        "The primary owner account cannot be modified."
      );
    }

    const registryRef = db
      .collection("ownerSuperAdmins")
      .doc(target.uid);

    const registrySnapshot = await registryRef.get();

    if (registrySnapshot.exists) {
      throw new HttpsError(
        "already-exists",
        "This account already has an additional Super Admin record."
      );
    }

    if (target.customClaims?.superadmin === true) {
      throw new HttpsError(
        "already-exists",
        "This account already has Super Admin access. Manual review is required."
      );
    }

    const originalRole = profile.role;

    if (!["driver", "broker", "admin"].includes(originalRole)) {
      throw new HttpsError(
        "failed-precondition",
        "The account's original role cannot be safely preserved."
      );
    }

    const existingClaims = target.customClaims || {};

    // Grant claims using the Admin SDK only.
    await auth.setCustomUserClaims(target.uid, {
      ...existingClaims,
      admin: true,
      superadmin: true,
      primaryOwner: false
    });

    await targetRef.update({
      role: "superadmin",
      updatedAt: FieldValue.serverTimestamp()
    });

    await registryRef.set({
      uid: target.uid,
      email,
      originalRole,
      status: "active",
      grantedBy: owner.uid,
      grantedByEmail: OWNER_EMAIL,
      grantedAt: FieldValue.serverTimestamp()
    });

    await recordOwnerAction(
      owner,
      "addSuperAdminByEmail",
      target.uid,
      email,
      { originalRole }
    );

    return {
      success: true,
      message:
        `Super Admin access granted to ${email}. They must sign out and sign in again.`
    };
  }
);

// ======================================================
// REVOKE ADDITIONAL SUPER ADMIN
// PRIMARY OWNER ONLY
// ======================================================

exports.revokeSuperAdminByEmail = onCall(
  { region: REGION },
  async (request) => {
    const owner = requirePrimaryOwner(request);
    const email = validateEmail(request.data?.email);

    if (email === OWNER_EMAIL) {
      throw new HttpsError(
        "permission-denied",
        "The primary owner cannot be removed."
      );
    }

    let target;

    try {
      target = await auth.getUserByEmail(email);
    } catch (error) {
      if (error.code === "auth/user-not-found") {
        throw new HttpsError(
          "not-found",
          "The account was not found."
        );
      }

      throw error;
    }

    const registryRef = db
      .collection("ownerSuperAdmins")
      .doc(target.uid);

    const registrySnapshot = await registryRef.get();

    if (!registrySnapshot.exists) {
      throw new HttpsError(
        "not-found",
        "No additional Super Admin access record exists."
      );
    }

    const registry = registrySnapshot.data();

    if (registry.status !== "active") {
      throw new HttpsError(
        "failed-precondition",
        "This Super Admin access is not active."
      );
    }

    if (
      target.customClaims?.primaryOwner === true ||
      target.uid === OWNER_UID.value()
    ) {
      throw new HttpsError(
        "permission-denied",
        "The primary owner cannot be removed."
      );
    }

    const targetRef = db.collection("users").doc(target.uid);
    const profileSnapshot = await targetRef.get();

    if (!profileSnapshot.exists) {
      throw new HttpsError(
        "not-found",
        "The user's profile was not found. Manual review is required."
      );
    }

    const existingClaims = target.customClaims || {};
    const updatedClaims = { ...existingClaims };

    delete updatedClaims.superadmin;
    delete updatedClaims.primaryOwner;

    if (registry.originalRole === "admin") {
      updatedClaims.admin = true;
    } else {
      delete updatedClaims.admin;
    }

    // Restore original custom claims.
    await auth.setCustomUserClaims(target.uid, updatedClaims);

    // Restore the original profile role.
    await targetRef.update({
      role: registry.originalRole,
      updatedAt: FieldValue.serverTimestamp()
    });

    await registryRef.update({
      status: "revoked",
      revokedBy: owner.uid,
      revokedByEmail: OWNER_EMAIL,
      revokedAt: FieldValue.serverTimestamp()
    });

    await recordOwnerAction(
      owner,
      "revokeSuperAdminByEmail",
      target.uid,
      email,
      { restoredRole: registry.originalRole }
    );

    return {
      success: true,
      message:
        `Additional Super Admin access revoked for ${email}.`
    };
  }
);

// ======================================================
// LIST ADDITIONAL SUPER ADMINS
// PRIMARY OWNER ONLY
// ======================================================

exports.listAdditionalSuperAdmins = onCall(
  { region: REGION },
  async (request) => {
    requirePrimaryOwner(request);

    const snapshot = await db
      .collection("ownerSuperAdmins")
      .where("status", "==", "active")
      .get();

    const administrators = snapshot.docs.map((document) => {
      const data = document.data();

      return {
        uid: document.id,
        email: data.email || "",
        originalRole: data.originalRole || "",
        status: data.status || "",
        grantedAt: data.grantedAt
          ? data.grantedAt.toDate().toISOString()
          : null
      };
    });

    return {
      success: true,
      administrators
    };
  }
);
