const { AppDataSource } = require("../db");
const { Carousel } = require("../entities/Carousel");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const carouselRepo = AppDataSource.getRepository(Carousel);

// ─────────────────────────────────────────────────────────────────
// IMAGE HELPERS
// ─────────────────────────────────────────────────────────────────

function toRelativePath(p) {
  if (!p) return null;
  const s = p.replace(/\\/g, "/");
  const match = s.match(/uploads\/.*/i);
  return match ? match[0] : s;
}


function formatCarousel(c) {
  if (!c) return c;
  return {
    ...c,
    image: toRelativePath(c.image)
  };
}

// ─────────────────────────────────────────────────────────────────
// MULTER
// ─────────────────────────────────────────────────────────────────
const UPLOAD_ROOT = path.join(__dirname, "..", "uploads");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(UPLOAD_ROOT, "carousel");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "banner-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only images are allowed"), false);
  }
});

const uploadMiddleware = upload.single("image");
const fileToRelative = (file) => file ? toRelativePath(file.path) : null;

// ─────────────────────────────────────────────────────────────────
// CONTROLLERS
// ─────────────────────────────────────────────────────────────────

exports.getAll = async (req, res) => {
  try {
    const slides = await carouselRepo.find({
      order: { order: "ASC" }
    });
    res.json(slides.map(formatCarousel));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.create = async (req, res) => {
  uploadMiddleware(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message });
    if (!req.file) return res.status(400).json({ message: "No image uploaded" });

    try {
      const data = {
        image: fileToRelative(req.file),
        title: req.body.title || "",
        subtitle: req.body.subtitle || "",
        link: req.body.link || "",
        order: parseInt(req.body.order) || 0,
        active: req.body.active === 'true' || req.body.active === true
      };

      const newItem = carouselRepo.create(data);
      const saved = await carouselRepo.save(newItem);
      res.status(201).json(formatCarousel(saved));
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
      const id = parseInt(req.params.id);
      const item = await carouselRepo.findOneBy({ id });
      if (!item) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(404).json({ message: "Not found" });
      }

      const oldImage = item.image;
      const data = {
        title: req.body.title !== undefined ? req.body.title : item.title,
        subtitle: req.body.subtitle !== undefined ? req.body.subtitle : item.subtitle,
        link: req.body.link !== undefined ? req.body.link : item.link,
        order: req.body.order !== undefined ? parseInt(req.body.order) : item.order,
        active: req.body.active !== undefined ? (req.body.active === 'true' || req.body.active === true) : item.active
      };

      if (req.file) {
        data.image = fileToRelative(req.file);
        const oldAbs = path.join(UPLOAD_ROOT, "..", toRelativePath(oldImage));
        if (oldImage && fs.existsSync(oldAbs)) fs.unlinkSync(oldAbs);
      }

      carouselRepo.merge(item, data);
      const updated = await carouselRepo.save(item);
      res.json(formatCarousel(updated));
    } catch (error) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(500).json({ message: error.message });
    }
  });
};

exports.remove = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const item = await carouselRepo.findOneBy({ id });
    if (!item) return res.status(404).json({ message: "Not found" });

    const absPath = path.join(UPLOAD_ROOT, "..", toRelativePath(item.image));
    if (item.image && fs.existsSync(absPath)) fs.unlinkSync(absPath);
    await carouselRepo.remove(item);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
