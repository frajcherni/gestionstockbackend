const { AppDataSource } = require("../db");
const { Testimonial } = require("../entities/Testimonial");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// ─────────────────────────────────────────────────────────────────
// IMAGE HELPERS
// ─────────────────────────────────────────────────────────────────
function toRelativePath(p) {
  if (!p) return null;
  const s = p.replace(/\\/g, "/");
  const match = s.match(/uploads\/.*/i);
  return match ? match[0] : s;
}

function formatTestimonial(t) {
  if (!t) return t;
  return { ...t, image: toRelativePath(t.image) };
}

// ─────────────────────────────────────────────────────────────────
// MULTER CONFIG
// ─────────────────────────────────────────────────────────────────
const UPLOAD_ROOT = path.join(__dirname, "..", "uploads");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(UPLOAD_ROOT, "testimonials");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "testimonial-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only images are allowed"), false);
  },
});

const uploadMiddleware = upload.single("image");
const fileToRelative = (file) => (file ? toRelativePath(file.path) : null);
const parseBool = (v, fallback) =>
  v !== undefined ? v === "true" || v === true : fallback;

// ─────────────────────────────────────────────────────────────────
// CONTROLLERS
// ─────────────────────────────────────────────────────────────────
exports.getAll = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(Testimonial);
    const items = await repo.find({ order: { order: "ASC", id: "ASC" } });
    res.json(items.map(formatTestimonial));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.create = async (req, res) => {
  uploadMiddleware(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message });
    if (!req.file) return res.status(400).json({ message: "No image uploaded" });
    try {
      const repo = AppDataSource.getRepository(Testimonial);
      const data = {
        image: fileToRelative(req.file),
        name: req.body.name || null,
        order: parseInt(req.body.order) || 0,
        active: parseBool(req.body.active, true),
      };
      const saved = await repo.save(repo.create(data));
      res.status(201).json(formatTestimonial(saved));
    } catch (error) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(500).json({ message: error.message });
    }
  });
};

exports.update = async (req, res) => {
  uploadMiddleware(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message });
    try {
      const repo = AppDataSource.getRepository(Testimonial);
      const id = parseInt(req.params.id);
      const item = await repo.findOneBy({ id });
      if (!item) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(404).json({ message: "Not found" });
      }
      const oldImage = item.image;
      const field = (k, fb) => (req.body[k] !== undefined ? req.body[k] : fb);

      const data = {
        name: field("name", item.name),
        order: req.body.order !== undefined ? parseInt(req.body.order) : item.order,
        active: parseBool(req.body.active, item.active),
      };

      if (req.file) {
        data.image = fileToRelative(req.file);
        if (oldImage) {
          const absPath = path.join(UPLOAD_ROOT, "..", toRelativePath(oldImage));
          if (fs.existsSync(absPath)) {
            try { fs.unlinkSync(absPath); } catch (e) {}
          }
        }
      }

      repo.merge(item, data);
      const updated = await repo.save(item);
      res.json(formatTestimonial(updated));
    } catch (error) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(500).json({ message: error.message });
    }
  });
};

exports.remove = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(Testimonial);
    const id = parseInt(req.params.id);
    const item = await repo.findOneBy({ id });
    if (!item) return res.status(404).json({ message: "Not found" });
    const absPath = path.join(UPLOAD_ROOT, "..", toRelativePath(item.image));
    if (item.image && fs.existsSync(absPath)) {
      try { fs.unlinkSync(absPath); } catch (e) {}
    }
    await repo.remove(item);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
