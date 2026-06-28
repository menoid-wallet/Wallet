const express = require("express");

const router = express.Router();

const {
  createFeedback,
  getAllFeedback
} = require("../controllers/feedbackController");

router.post("/create", createFeedback);

router.get("/all", getAllFeedback);

module.exports = router;
