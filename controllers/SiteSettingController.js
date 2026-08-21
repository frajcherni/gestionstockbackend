const { AppDataSource } = require("../db");
const { SiteSetting } = require("../entities/SiteSetting");
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

function formatSetting(s) {
  if (!s) return s;
  return { ...s, logo: toRelativePath(s.logo), promo_image: toRelativePath(s.promo_image) };
}

// ─────────────────────────────────────────────────────────────────
// MULTER CONFIG
// ─────────────────────────────────────────────────────────────────
const UPLOAD_ROOT = path.join(__dirname, "..", "uploads");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(UPLOAD_ROOT, "site");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "logo-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only images are allowed"), false);
  },
});

const uploadMiddleware = upload.fields([
  { name: "logo", maxCount: 1 },
  { name: "promo_image", maxCount: 1 },
]);
const fileToRelative = (file) => (file ? toRelativePath(file.path) : null);
const parseBool = (v, fallback) =>
  v !== undefined ? v === "true" || v === true : fallback;

const unlinkQuiet = (relative) => {
  if (!relative) return;
  const absPath = path.join(UPLOAD_ROOT, "..", toRelativePath(relative));
  if (fs.existsSync(absPath)) {
    try { fs.unlinkSync(absPath); } catch (e) {}
  }
};

/** The settings row, created with defaults the first time it is asked for. */
async function getOrCreate() {
  const repo = AppDataSource.getRepository(SiteSetting);
  const existing = await repo.find({ order: { id: "ASC" }, take: 1 });
  if (existing.length > 0) return existing[0];
  return repo.save(
    repo.create({
      logo: null,
      brand_name: "LUMIÈRE",
      show_name: true,
      logo_height: 34,
      // Set here rather than as a DB column default: the apostrophe in
      // "l'excellence" breaks TypeORM's raw ALTER TABLE ... DEFAULT '...' DDL.
      footer_about_text:
        "Redéfinir le luxe par un savoir-faire choisi avec soin et un design intemporel. Rejoignez notre quête de l'excellence.",
    })
  ); // promo_*, footer_about_title and social fields fall back to their column defaults
}

// ─────────────────────────────────────────────────────────────────
// CONTROLLERS
// ─────────────────────────────────────────────────────────────────
exports.get = async (req, res) => {
  try {
    res.json(formatSetting(await getOrCreate()));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const TEXT_FIELDS = [
  "brand_name",
  "promo_title",
  "promo_description",
  "footer_about_title",
  "footer_about_text",
  "facebook_url",
  "instagram_url",
  "tiktok_url",
];

exports.update = async (req, res) => {
  uploadMiddleware(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message });
    const logoFile = req.files?.logo?.[0];
    const promoFile = req.files?.promo_image?.[0];
    try {
      const repo = AppDataSource.getRepository(SiteSetting);
      const item = await getOrCreate();
      const oldLogo = item.logo;
      const oldPromoImage = item.promo_image;

      const data = {
        show_name: parseBool(req.body.show_name, item.show_name),
        logo_height:
          req.body.logo_height !== undefined
            ? parseInt(req.body.logo_height) || item.logo_height
            : item.logo_height,
      };
      TEXT_FIELDS.forEach((field) => {
        data[field] = req.body[field] !== undefined ? req.body[field] : item[field];
      });

      if (logoFile) data.logo = fileToRelative(logoFile);
      if (promoFile) data.promo_image = fileToRelative(promoFile);

      repo.merge(item, data);
      const updated = await repo.save(item);

      // Only drop the previous files once the new row is safely persisted.
      if (logoFile && oldLogo) unlinkQuiet(oldLogo);
      if (promoFile && oldPromoImage) unlinkQuiet(oldPromoImage);

      res.json(formatSetting(updated));
    } catch (error) {
      if (logoFile && fs.existsSync(logoFile.path)) fs.unlinkSync(logoFile.path);
      if (promoFile && fs.existsSync(promoFile.path)) fs.unlinkSync(promoFile.path);
      res.status(500).json({ message: error.message });
    }
  });
};

/** Clears the logo so the site falls back to the text wordmark. */
exports.removeLogo = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(SiteSetting);
    const item = await getOrCreate();
    const oldLogo = item.logo;
    item.logo = null;
    const updated = await repo.save(item);
    unlinkQuiet(oldLogo);
    res.json(formatSetting(updated));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/** Clears the promo background so the site falls back to the built-in image. */
exports.removePromoImage = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(SiteSetting);
    const item = await getOrCreate();
    const oldPromoImage = item.promo_image;
    item.promo_image = null;
    const updated = await repo.save(item);
    unlinkQuiet(oldPromoImage);
    res.json(formatSetting(updated));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
