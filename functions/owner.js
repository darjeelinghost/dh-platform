
"use strict";

// ======================================================
// DARJEELINGHOST - OWNER & SUPER ADMIN ACCESS
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

const OWNER_EMAIL = "darjeelinghost@gmail.com";
const REGION = "asia-south1";

const auth = getAuth();
const db = getFirestore();

// ======================================================
// PRIMARY OWNER VERIFICATION
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
  const user = requireSignedIn(request);
  const email = String(user.token.email || "").toLowerCase();

  if (email !== OWNER_EMAIL) {
    throw new HttpsError(
      "permission-denied",
      "Only the registered primary owner can perform this operation."
    );
  }

  if (user.token.email_verified !== true) {
    throw new HttpsError(
      "failed-precondition",
      "Verify the primary owner's email before continuing."
    );
  }

  return user;
}

// ======================================================
// AUDIT LOG
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
// INITIALISE OR RECOVER PRIMARY OWNER ACCESS
// ======================================================

exports.bootstrapSuperAdmin = onCall(
  { region: REGION },
  async (request) => {
    const owner = requirePrimaryOwner(request);

    const ownerRecord = await auth.getUser(owner.uid);

    if (!ownerRecord.emailVerified) {
      throw new HttpsError(
        "failed-precondition",
        "Verify your owner email before setup."
      );
    }

    const lockRef = db
      .collection("system")
      .doc("superAdminBootstrap");

    const profileRef = db
      .collection("users")
      .doc(owner.uid);

    const lockSnapshot = await lockRef.get();

    // The exact verified owner email is authoritative.
    // A previous interrupted bootstrap can be repaired
    // by the same primary owner account.

    if (lockSnapshot.exists) {
      const lockData = lockSnapshot.data() || {};

      if (
        lockData.ownerEmail &&
        String(lockData.ownerEmail).toLowerCase() !== OWNER_EMAIL
      ) {
        throw new HttpsError(
          "permission-denied",
          "The existing owner setup belongs to a different owner identity. Manual security review is required."
        );
      }
    }

    const existingClaims = ownerRecord.customClaims || {};

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
      displayName: ownerRecord.displayName || "DarjeelingHost Owner",
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

    await lockRef.set({
      ownerUid: owner.uid,
      ownerEmail: OWNER_EMAIL,
      status: "completed",
      updatedAt: FieldValue.serverTimestamp(),
      completedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    await recordOwnerAction(
      owner,
      "bootstrapSuperAdmin",
      owner.uid,
      OWNER_EMAIL,
      { description: "Primary owner access initialised or recovered." }
    );

    return {
      success: true,
      message: "Primary owner access is ready. Sign out and sign in again to refresh permissions."
    };
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

    const email = String(request.data?.email || "")
      .trim()
      .toLowerCase();

    if (
      !email ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Enter a valid email address."
      );
    }

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
          "This email does not have a registered DarjeelingHost account yet. Ask the person to register first."
        );
      }

      throw error;
    }

    if (!target.emailVerified) {
      throw new HttpsError(
        "failed-precondition",
        "The additional administrator must verify their email first."
      );
    }

    const targetRef = db.collection("users").doc(target.uid);
    const targetSnapshot = await targetRef.get();

    if (!targetSnapshot.exists) {
      throw new HttpsError(
        "failed-precondition",
        "The target account does not have a DarjeelingHost profile."
      );
    }

    const profile = targetSnapshot.data();

    if (profile.status !== "active") {
      throw new HttpsError(
        "failed-precondition",
        "Only active accounts can become additional Super Admins."
      );
    }

    if (profile.ownerAccount === true) {
      throw new HttpsError(
        "permission-denied",
        "The primary owner account cannot be modified here."
      );
    }

    const existingClaims = target.customClaims || {};

    if (existingClaims.superadmin === true) {
      throw new HttpsError(
        "already-exists",
        "This account is already a Super Admin."
      );
    }

    const originalRole = profile.role;

    if (!["driver", "broker", "admin"].includes(originalRole)) {
      throw new HttpsError(
        "failed-precondition",
        "The account's original role cannot be safely preserved."
      );
    }

    const registryRef = db
      .collection("ownerSuperAdmins")
      .doc(target.uid);

    const registrySnapshot = await registryRef.get();

    if (registrySnapshot.exists) {
      throw new HttpsError(
        "already-exists",
        "This account already has a Super Admin access record."
      );
    }

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
      grantedBy: owner.uid,
      grantedByEmail: OWNER_EMAIL,
      status: "active",
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
      message: `Super Admin access granted to ${email}. They must sign out and sign in again.`
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

    const email = String(request.data?.email || "")
      .trim()
      .toLowerCase();

    if (!email || email === OWNER_EMAIL) {
      throw new HttpsError(
        "permission-denied",
        "The primary owner cannot be removed or modified."
      );
    }

    let target;

    try {
      target = await auth.getUserByEmail(email);
    } catch (error) {
      if (error.code === "auth/user-not-found") {
        throw new HttpsError(
          "not-found",
          "The specified account was not found."
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
        "No additional Super Admin record exists for this account."
      );
    }

    const registry = registrySnapshot.data();

    if (registry.status !== "active") {
      throw new HttpsError(
        "failed-precondition",
        "This Super Admin access is not active."
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

    await auth.setCustomUserClaims(target.uid, updatedClaims);

    const targetRef = db.collection("users").doc(target.uid);

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
      message: `Additional Super Admin access revoked for ${email}.`
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

    return {
      success: true,
      administrators: snapshot.docs.map((item) => {
        const data = item.data();

        return {
          uid: item.id,
          email: data.email || "",
          grantedAt: data.grantedAt
            ? data.grantedAt.toDate().toISOString()
            : null
        };
      })
    };
  }
);
