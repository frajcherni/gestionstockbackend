


const { AppDataSource } = require('../db');
const { Categorie } = require('../entities/Categorie');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const repo = AppDataSource.getRepository(Categorie);

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
// MULTER
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
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'category-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

const uploadMiddleware = upload.single('image');
const fileToRelative = (file) => file ? toRelativePath(file.path) : null;

// ─────────────────────────────────────────────────────────────────
// CONTROLLERS
// ─────────────────────────────────────────────────────────────────

exports.getAll = async (req, res) => {
  try {
    const onWebsite = req.query.onWebsite;
    let list;

    if (onWebsite !== undefined) {
      list = await repo.find({
        where: { on_website: onWebsite === 'true' || onWebsite === true }
      });
    } else {
      list = await repo.find();
    }

    const categoriesWithParentNames = list.map(cat => {
      let parentName = null;
      if (cat.parent_id) {
        const parent = list.find(p => p.id === cat.parent_id);
        parentName = parent ? parent.nom : 'Unknown';
      }

      return {
        ...formatCategorie(cat),
        parentName: parentName
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
        website_order: parseInt(req.body.website_order) || 0
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
      const id = parseInt(req.params.id);
      let item = await repo.findOneBy({ id });

      if (!item) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(404).json({ message: 'Category not found' });
      }

      const oldImage = item.image;
      const data = {
        nom: req.body.nom,
        description: req.body.description,
        parent_id: req.body.parent_id !== undefined ? (req.body.parent_id || null) : item.parent_id,
        on_website: req.body.on_website !== undefined ? (req.body.on_website === 'true' || req.body.on_website === true) : item.on_website,
        website_order: req.body.website_order !== undefined ? (parseInt(req.body.website_order) || 0) : item.website_order
      };

      if (req.file) {
        data.image = fileToRelative(req.file);
        const oldAbs = path.join(UPLOAD_ROOT, "..", toRelativePath(oldImage));
        if (oldImage && fs.existsSync(oldAbs)) fs.unlinkSync(oldAbs);
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
    const id = parseInt(req.params.id);
    const item = await repo.findOneBy({ id });

    if (!item) return res.status(404).json({ message: 'Category not found' });

    const absPath = path.join(UPLOAD_ROOT, "..", toRelativePath(item.image));
    if (item.image && fs.existsSync(absPath)) {
      try { fs.unlinkSync(absPath); } catch (err) { console.error("Failed to delete image file:", err); }
    }

    await repo.delete(id);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
