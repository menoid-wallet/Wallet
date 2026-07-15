/**
 * Build-compat patch for `math-intrinsics` (transitive dep via assert -> call-bind
 * -> get-intrinsic -> math-intrinsics).
 *
 * Plasmo 0.90.5 bundles Parcel 2.9.3, whose resolver bails when a package has
 * `"main": false` alongside an `exports` map. That makes it fail to resolve the
 * internal relative require `require('./isNaN')` inside math-intrinsics/sign.js:
 *
 *   ERROR | Failed to resolve './isNaN' from './node_modules/math-intrinsics/sign.js'
 *
 * The fix is to remove the `"main": false` line from math-intrinsics/package.json
 * while keeping its `exports` map intact. This does NOT change any dependency
 * version (math-intrinsics stays 1.1.0) — it only repairs broken metadata that
 * this older Parcel resolver cannot handle.
 *
 * Runs on postinstall so it re-applies automatically after every install.
 * Idempotent: a no-op if the line is already gone or the package is absent.
 */
const fs = require("fs")
const path = require("path")

const pkgPath = path.join(
  __dirname,
  "..",
  "node_modules",
  "math-intrinsics",
  "package.json"
)

try {
  if (!fs.existsSync(pkgPath)) {
    // Not installed (e.g. deps not yet fetched) — nothing to patch.
    process.exit(0)
  }

  const src = fs.readFileSync(pkgPath, "utf8")
  const patched = src.replace(/^\s*"main":\s*false,\n/m, "")

  if (patched === src) {
    // Already patched or structure changed — leave as-is.
    process.exit(0)
  }

  fs.writeFileSync(pkgPath, patched)
  console.log(
    "[fix-math-intrinsics] Removed \"main\": false for Parcel 2.9.3 compatibility."
  )
} catch (err) {
  // Never fail the install over this best-effort patch.
  console.warn("[fix-math-intrinsics] Skipped:", err.message)
  process.exit(0)
}
