const mongoose = require("mongoose");

/**
 * Install
 *
 * One row per installation of the wallet — the closest thing we have to a
 * download count, since Menoid ships as a sideloaded APK and an unpacked
 * extension rather than through a store that would count for us.
 *
 * HOW AN "INSTALL" IS COUNTED. The client mints a random id the first time it
 * ever runs and keeps it in local storage, then reports it here. So:
 *
 *   installs      = documents in this collection
 *   active today  = documents whose lastSeen is today
 *   uninstalls    = invisible; a device that stops reporting simply goes quiet
 *
 * That last point is worth being honest about. Clearing app data or reinstalling
 * mints a NEW id, so this over-counts slightly, and one person with a phone and
 * a browser is two installs. It measures installations, not people — which is
 * the right unit for "how far has the demo spread" and the wrong one for "how
 * many users do I have". There is no way to do better without asking for an
 * account, which this product deliberately does not do.
 */
const installSchema = new mongoose.Schema(
  {
    /** Random, client-generated. The only identifier we have. */
    installId: { type: String, required: true, unique: true, index: true },

    /** "android" | "extension" */
    platform: { type: String, required: true, index: true },
    appVersion: { type: String },

    /** Coarse environment, useful for reproducing bugs. Never anything unique. */
    osVersion: { type: String },
    deviceModel: { type: String },
    locale: { type: String },

    firstSeen: { type: Date, default: Date.now, index: true },
    lastSeen: { type: Date, default: Date.now, index: true },
    /** Times the app has been opened. Cheap retention signal. */
    sessions: { type: Number, default: 1 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Install", installSchema);
