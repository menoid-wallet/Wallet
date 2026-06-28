const Feedback = require("../models/Feedback");

// create feedback (one survey submission from the wallet)
async function createFeedback(req, res) {
  try {
    const {
      setupEase,
      uiUxRating,
      primaryWalletNps,
      pirateTheme,
      mostImpressive,
      recommend,
      buildNext,
      confusing,
      improve,
      additional,
      email,
      discord,
      twitter,
      walletAddress,
      mode
    } = req.body;

    if (!email || !String(email).trim()) {
      return res.status(400).json({ error: "Email is required" });
    }

    const feedback = await Feedback.create({
      setupEase,
      uiUxRating,
      primaryWalletNps,
      pirateTheme,
      mostImpressive,
      recommend,
      buildNext: Array.isArray(buildNext) ? buildNext : [],
      confusing,
      improve,
      additional,
      email,
      discord,
      twitter,
      walletAddress,
      mode
    });

    return res.status(201).json(feedback);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to save feedback" });
  }
}

// get all feedback (admin)
async function getAllFeedback(req, res) {
  try {
    const feedback = await Feedback.find().sort({ createdAt: -1 });
    return res.json(feedback);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to fetch feedback" });
  }
}

module.exports = {
  createFeedback,
  getAllFeedback
};
