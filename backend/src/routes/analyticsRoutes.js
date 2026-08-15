const express = require("express");

const router = express.Router();

const {
  registerInstall,
  ingestEvents,
  getSummary,
  getTimings,
} = require("../controllers/analyticsController");

router.post("/install", registerInstall);
router.post("/events", ingestEvents);

router.get("/summary", getSummary);
router.get("/timings", getTimings);

module.exports = router;
