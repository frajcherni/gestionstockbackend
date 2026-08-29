const { AppDataSource } = require("../db");
const { Categorie } = require("../entities/Categorie");
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

function formatCategorie(c) {
  if (!c) return c;
  return {
    ...c,
    image: toRelativePath(c.image)
  };
}

// ─────────────────────────────────────────────────────────────────
// MULTER CONFIG
// ─────────────────────────────────────────────────────────────────
const UPLOAD_ROOT = path.join(__dirname, "..", "uploads");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(UPLOAD_ROOT, "categories");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "category-" + uniqueSuffix + path.extname(file.originalname));
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
    const repo = AppDataSource.getRepository(Categorie);
    const onWebsite = req.query.onWebsite;

    // Always read every category: parent names have to resolve against the full
    // set, otherwise a sub-category whose parent is not flagged on_website came
    // back with parentName "Unknown" and lost its place in the tree.
    const all = await repo.find();

    const wantWebsite = onWebsite === 'true' || onWebsite === true;
    const list = onWebsite !== undefined
      ? all.filter(c => wantWebsite ? (Boolean(c.on_website) || Boolean(c.show_in_univers)) : (!c.on_website && !c.show_in_univers))
      : all;

    const visibleIds = new Set(list.map(c => c.id));

    const categoriesWithParentNames = list.map(cat => {
      let parentName = null;
      if (cat.parent_id) {
        const parent = all.find(p => p.id === cat.parent_id);
        parentName = parent ? parent.nom : null;
      }

      return {
        ...formatCategorie(cat),
        parentName,
        // The website builds its menu from parent_id. When the parent is not
        // part of this result set the child must surface as a root instead of
        // pointing at a category the caller cannot see.
        parent_id: cat.parent_id && visibleIds.has(cat.parent_id) ? cat.parent_id : null,
        // Convenience flags so callers do not have to re-derive the tree.
        has_children: list.some(c => c.parent_id === cat.id),
      };
    });

    res.json(categoriesWithParentNames);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.create = async (req, res) => {
  uploadMiddleware(req, res, async function (err) {
    if (err) return res.status(400).json({ message: err.message });

    try {
      const repo = AppDataSource.getRepository(Categorie);
      if (!req.body.nom) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: 'Category name is required' });
      }

      const data = {
        nom: req.body.nom,
        description: req.body.description || '',
        parent_id: req.body.parent_id || null,
        image: fileToRelative(req.file),
        on_website: req.body.on_website === 'true' || req.body.on_website === true,
        website_order: parseInt(req.body.website_order) || 0,
        show_in_univers: req.body.show_in_univers === 'true' || req.body.show_in_univers === true,
        univers_order: parseInt(req.body.univers_order) || 0,
      };

      const newItem = repo.create(data);
      const saved = await repo.save(newItem);
      res.status(201).json(formatCategorie(saved));
    } catch (error) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(400).json({ message: error.message });
    }
  });
};

exports.update = async (req, res) => {
  uploadMiddleware(req, res, async function (err) {
    if (err) return res.status(400).json({ message: err.message });

    try {
      const repo = AppDataSource.getRepository(Categorie);
      const id = parseInt(req.params.id);
      let item = await repo.findOneBy({ id });

      if (!item) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(404).json({ message: 'Category not found' });
      }

      const oldImage = item.image;
      const data = {
        nom: req.body.nom !== undefined ? req.body.nom : item.nom,
        description: req.body.description !== undefined ? req.body.description : item.description,
        parent_id: req.body.parent_id !== undefined ? (req.body.parent_id || null) : item.parent_id,
        on_website: req.body.on_website !== undefined ? (req.body.on_website === 'true' || req.body.on_website === true) : item.on_website,
        website_order: req.body.website_order !== undefined ? parseInt(req.body.website_order) : item.website_order,
        show_in_univers: req.body.show_in_univers !== undefined ? (req.body.show_in_univers === 'true' || req.body.show_in_univers === true) : item.show_in_univers,
        univers_order: req.body.univers_order !== undefined ? parseInt(req.body.univers_order) : item.univers_order,
      };

      if (req.file) {
        data.image = fileToRelative(req.file);
        if (oldImage) {
            const absPath = path.join(UPLOAD_ROOT, "..", toRelativePath(oldImage));
            if (fs.existsSync(absPath)) {
                try { fs.unlinkSync(absPath); } catch(e) {}
            }
        }
      }


      repo.merge(item, data);
      const updated = await repo.save(item);
      res.json(formatCategorie(updated));
    } catch (error) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(400).json({ message: error.message });
    }
  });
};

exports.remove = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(Categorie);
    const id = parseInt(req.params.id);
    const item = await repo.findOneBy({ id });

    if (!item) return res.status(404).json({ message: 'Category not found' });

    if (item.image) {
      const absPath = path.join(UPLOAD_ROOT, "..", toRelativePath(item.image));
      if (fs.existsSync(absPath)) {
        try { fs.unlinkSync(absPath); } catch(e) {}
      }
    }

    await repo.remove(item);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
