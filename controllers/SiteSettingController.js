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

/**
 * Copy shown when a field has never been filled in.
 *
 * These live here rather than as DB column defaults on purpose: the strings
 * contain apostrophes, which TypeORM's schema-sync would splice unescaped
 * into its raw `ALTER TABLE … DEFAULT '…'` statement. Applying them on read
 * also means a settings row created before these columns existed still comes
 * back complete instead of a page full of blanks.
 */
const TEXT_DEFAULTS = {
  deals_title: "Les bonnes affaires du moment",
  deals_description: "Découvrez nos produits actuellement en promotion.",
  deals_btn_label: "Voir toutes les promotions",

  showroom_title: "Visitez notre showroom",
  showroom_description:
    "Venez découvrir nos collections en personne et bénéficier de conseils personnalisés.",
  showroom_btn_label: "Découvrir notre showroom",
  showroom_btn_link: "",

  contact_address: "15 Rue du Faubourg Saint-Honoré, 75008 Paris",
  contact_phone: "+216 20 123 456",
  contact_email: "contact@royallumiere.tn",
  working_hours_week: "Lun - Jeu: 09:00 - 18:00",
  working_hours_friday: "Ven: 09:00 - 12:00, 14:00 - 18:00",
};

/**
 * The footer category list is stored as a JSON string; hand the front office a
 * real array of numeric ids. A malformed or legacy value degrades to an empty
 * list, which the shop reads as "fall back to the first root categories".
 */
function parseCategoryIds(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(Number).filter((n) => Number.isFinite(n));
  } catch (e) {
    return [];
  }
}

function formatSetting(s) {
  if (!s) return s;
  const out = {
    ...s,
    logo: toRelativePath(s.logo),
    promo_image: toRelativePath(s.promo_image),
    showroom_image: toRelativePath(s.showroom_image),
    footer_category_ids: parseCategoryIds(s.footer_category_ids),
  };
  Object.entries(TEXT_DEFAULTS).forEach(([key, fallback]) => {
    if (out[key] === null || out[key] === undefined || out[key] === "") out[key] = fallback;
  });
  return out;
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
  { name: "showroom_image", maxCount: 1 },
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
  "deals_title",
  "deals_description",
  "deals_btn_label",
  "showroom_title",
  "showroom_description",
  "showroom_btn_label",
  "showroom_btn_link",
  "footer_about_title",
  "footer_about_text",
  "facebook_url",
  "instagram_url",
  "tiktok_url",
  "contact_address",
  "contact_phone",
  "contact_email",
  "working_hours_week",
  "working_hours_friday",
];

exports.update = async (req, res) => {
  uploadMiddleware(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message });
    const logoFile = req.files?.logo?.[0];
    const promoFile = req.files?.promo_image?.[0];
    const showroomFile = req.files?.showroom_image?.[0];
    try {
      const repo = AppDataSource.getRepository(SiteSetting);
      const item = await getOrCreate();
      const oldLogo = item.logo;
      const oldPromoImage = item.promo_image;
      const oldShowroomImage = item.showroom_image;

      const data = {
        show_name: parseBool(req.body.show_name, item.show_name),
        showroom_active: parseBool(req.body.showroom_active, item.showroom_active),
        logo_height:
          req.body.logo_height !== undefined
            ? parseInt(req.body.logo_height) || item.logo_height
            : item.logo_height,
      };
      TEXT_FIELDS.forEach((field) => {
        data[field] = req.body[field] !== undefined ? req.body[field] : item[field];
      });

      // Arrives as a JSON string (the form is multipart, so it cannot carry a
      // real array). Re-serialise from the parsed ids so a hand-crafted or
      // malformed payload can never be written straight into the column.
      if (req.body.footer_category_ids !== undefined) {
        data.footer_category_ids = JSON.stringify(
          parseCategoryIds(req.body.footer_category_ids)
        );
      }

      if (logoFile) data.logo = fileToRelative(logoFile);
      if (promoFile) data.promo_image = fileToRelative(promoFile);
      if (showroomFile) data.showroom_image = fileToRelative(showroomFile);

      repo.merge(item, data);
      const updated = await repo.save(item);

      // Only drop the previous files once the new row is safely persisted.
      if (logoFile && oldLogo) unlinkQuiet(oldLogo);
      if (promoFile && oldPromoImage) unlinkQuiet(oldPromoImage);
      if (showroomFile && oldShowroomImage) unlinkQuiet(oldShowroomImage);

      res.json(formatSetting(updated));
    } catch (error) {
      if (logoFile && fs.existsSync(logoFile.path)) fs.unlinkSync(logoFile.path);
      if (promoFile && fs.existsSync(promoFile.path)) fs.unlinkSync(promoFile.path);
      if (showroomFile && fs.existsSync(showroomFile.path)) fs.unlinkSync(showroomFile.path);
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

/** Clears the showroom photo so the band falls back to its built-in image. */
exports.removeShowroomImage = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(SiteSetting);
    const item = await getOrCreate();
    const oldShowroomImage = item.showroom_image;
    item.showroom_image = null;
    const updated = await repo.save(item);
    unlinkQuiet(oldShowroomImage);
    res.json(formatSetting(updated));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
