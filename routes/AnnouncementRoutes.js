const express = require("express");
const router = express.Router();
const announcementController = require("../controllers/AnnouncementController");

// Static paths first so "reorder" / "seed-defaults" are not swallowed by "/:id".
router.put("/reorder", announcementController.reorder);
router.post("/seed-defaults", announcementController.seedDefaults);

router.get("/", announcementController.getAll);
router.get("/:id", announcementController.getOne);
router.post("/", announcementController.create);
router.put("/:id", announcementController.update);
router.delete("/:id", announcementController.remove);

module.exports = router;
