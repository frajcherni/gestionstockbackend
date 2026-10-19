const { AppDataSource } = require("../db");
const { Carousel } = require("../entities/Carousel");
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

function formatCarousel(c) {
  if (!c) return c;
  return {
    ...c,
    image: toRelativePath(c.image),
    image_mobile: toRelativePath(c.image_mobile)
  };
}

// Deletes a stored upload ("uploads/..." path); a missing file is ignored.
function deleteStoredImage(p) {
  const rel = toRelativePath(p);
  if (!rel) return;
  const absPath = path.join(UPLOAD_ROOT, "..", rel);
  if (fs.existsSync(absPath)) {
    try { fs.unlinkSync(absPath); } catch (e) {}
  }
}

// ─────────────────────────────────────────────────────────────────
// MULTER CONFIG
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

// "image" is the desktop picture, "image_mobile" the optional tablet & phone one.
const uploadMiddleware = upload.fields([
  { name: "image", maxCount: 1 },
  { name: "image_mobile", maxCount: 1 },
]);
const fileToRelative = (file) => file ? toRelativePath(file.path) : null;
const uploaded = (req, name) => (req.files && req.files[name] ? req.files[name][0] : null);

// Removes this request's uploads when the slide could not be saved.
const discardUploads = (req) => {
  ["image", "image_mobile"].forEach((name) => {
    const file = uploaded(req, name);
    if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
  });
};

// ─────────────────────────────────────────────────────────────────
// CONTROLLERS
// ─────────────────────────────────────────────────────────────────

exports.getAll = async (req, res) => {
  try {
    const carouselRepo = AppDataSource.getRepository(Carousel);
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
    if (!uploaded(req, "image")) {
      discardUploads(req);
      return res.status(400).json({ message: "No image uploaded" });
    }

    try {
      const carouselRepo = AppDataSource.getRepository(Carousel);
      const parseBool = (v, fallback = true) =>
        v !== undefined ? (v === 'true' || v === true) : fallback;

      const data = {
        image: fileToRelative(uploaded(req, "image")),
        image_mobile: fileToRelative(uploaded(req, "image_mobile")),
        title: req.body.title || "",
        subtitle: req.body.subtitle || "",
        description: req.body.description || "",
        tag_color: req.body.tag_color || "",
        title_color: req.body.title_color || "",
        description_color: req.body.description_color || "",
        btn1_text_color: req.body.btn1_text_color || "",
        btn2_text_color: req.body.btn2_text_color || "",
        link: req.body.link || "",
        btn_label: req.body.btn_label || "",
        btn_color: req.body.btn_color || "",
        btn2_label: req.body.btn2_label || "",
        btn2_link: req.body.btn2_link || "",
        btn2_color: req.body.btn2_color || "",
        show_text: parseBool(req.body.show_text, true),
        show_btn1: parseBool(req.body.show_btn1, true),
        show_btn2: parseBool(req.body.show_btn2, true),
        order: parseInt(req.body.order) || 0,
        active: parseBool(req.body.active, true)
      };

      const newItem = carouselRepo.create(data);
      const saved = await carouselRepo.save(newItem);
      res.status(201).json(formatCarousel(saved));
    } catch (error) {
      discardUploads(req);
      res.status(500).json({ message: error.message });
    }
  });
};

exports.update = async (req, res) => {
  uploadMiddleware(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message });

    try {
      const carouselRepo = AppDataSource.getRepository(Carousel);
      const id = parseInt(req.params.id);
      const item = await carouselRepo.findOneBy({ id });
      
      if (!item) {
        discardUploads(req);
        return res.status(404).json({ message: "Not found" });
      }

      const parseBool = (v, fallback) =>
        v !== undefined ? (v === 'true' || v === true) : fallback;
      const field = (key, fallback) =>
        req.body[key] !== undefined ? req.body[key] : fallback;

      const data = {
        title: field('title', item.title),
        subtitle: field('subtitle', item.subtitle),
        description: field('description', item.description),
        tag_color: field('tag_color', item.tag_color),
        title_color: field('title_color', item.title_color),
        description_color: field('description_color', item.description_color),
        btn1_text_color: field('btn1_text_color', item.btn1_text_color),
        btn2_text_color: field('btn2_text_color', item.btn2_text_color),
        link: field('link', item.link),
        btn_label: field('btn_label', item.btn_label),
        btn_color: field('btn_color', item.btn_color),
        btn2_label: field('btn2_label', item.btn2_label),
        btn2_link: field('btn2_link', item.btn2_link),
        btn2_color: field('btn2_color', item.btn2_color),
        show_text: parseBool(req.body.show_text, item.show_text),
        show_btn1: parseBool(req.body.show_btn1, item.show_btn1),
        show_btn2: parseBool(req.body.show_btn2, item.show_btn2),
        order: req.body.order !== undefined ? parseInt(req.body.order) : item.order,
        active: parseBool(req.body.active, item.active)
      };

      // Replaced files are deleted only once the slide is saved.
      const replaced = [];
      const newImage = uploaded(req, "image");
      if (newImage) {
        data.image = fileToRelative(newImage);
        replaced.push(item.image);
      }

      // Tablet & phone image: replaced by a new upload, or removed on request
      // (the shop then shows the desktop image on every screen).
      const newMobile = uploaded(req, "image_mobile");
      if (newMobile) {
        data.image_mobile = fileToRelative(newMobile);
        replaced.push(item.image_mobile);
      } else if (parseBool(req.body.remove_image_mobile, false)) {
        data.image_mobile = null;
        replaced.push(item.image_mobile);
      }

      carouselRepo.merge(item, data);
      const updated = await carouselRepo.save(item);
      replaced.forEach(deleteStoredImage);
      res.json(formatCarousel(updated));
    } catch (error) {
      discardUploads(req);
      res.status(500).json({ message: error.message });
    }
  });
};

exports.remove = async (req, res) => {
  try {
    const carouselRepo = AppDataSource.getRepository(Carousel);
    const id = parseInt(req.params.id);
    const item = await carouselRepo.findOneBy({ id });
    if (!item) return res.status(404).json({ message: "Not found" });

    await carouselRepo.remove(item);
    deleteStoredImage(item.image);
    deleteStoredImage(item.image_mobile);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
