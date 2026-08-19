const { AppDataSource } = require("../db");
const { Announcement, MARKERS, ACCENTS } = require("../entities/Announcement");

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────
const parseBool = (v, fallback) =>
  v !== undefined ? v === "true" || v === true : fallback;

const pickMarker = (v, fallback = "sparkle") =>
  MARKERS.includes(v) ? v : fallback;

const pickAccent = (v, fallback = "gold") =>
  ACCENTS.includes(v) ? v : fallback;

/** The six messages the storefront used to hard-code, used by /seed-defaults. */
const DEFAULTS = [
  { text: "Livraison gratuite dès 50 DT", marker: "sparkle", accent: "gold" },
  { text: "Nouveautés chaque semaine", marker: "diamond", accent: "blue" },
  { text: "Retours gratuits sous 30 jours", marker: "ring", accent: "white" },
  { text: "Qualité premium garantie", marker: "square", accent: "gold" },
  { text: "Récompenses membres exclusives", marker: "plus", accent: "blue" },
  { text: "Support client 24/7", marker: "dot", accent: "white" },
];

// ─────────────────────────────────────────────────────────────────
// CONTROLLERS
// ─────────────────────────────────────────────────────────────────

/** GET /api/announcements?active=true */
exports.getAll = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(Announcement);
    const items = await repo.find({ order: { order: "ASC", id: "ASC" } });

    // The storefront asks for active=true; the admin table wants everything.
    const list =
      req.query.active !== undefined
        ? items.filter((a) => Boolean(a.active) === parseBool(req.query.active, true))
        : items;

    res.json(list);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/** GET /api/announcements/:id */
exports.getOne = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(Announcement);
    const item = await repo.findOneBy({ id: parseInt(req.params.id) });
    if (!item) return res.status(404).json({ message: "Annonce introuvable" });
    res.json(item);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/** POST /api/announcements */
exports.create = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(Announcement);

    const text = (req.body.text || "").trim();
    if (!text) return res.status(400).json({ message: "Le texte est obligatoire" });
    if (text.length > 180) {
      return res.status(400).json({ message: "Le texte ne peut pas dépasser 180 caractères" });
    }

    const saved = await repo.save(
      repo.create({
        text,
        marker: pickMarker(req.body.marker),
        accent: pickAccent(req.body.accent),
        order: parseInt(req.body.order) || 0,
        active: parseBool(req.body.active, true),
      })
    );

    res.status(201).json(saved);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

/** PUT /api/announcements/:id */
exports.update = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(Announcement);
    const item = await repo.findOneBy({ id: parseInt(req.params.id) });
    if (!item) return res.status(404).json({ message: "Annonce introuvable" });

    if (req.body.text !== undefined) {
      const text = String(req.body.text).trim();
      if (!text) return res.status(400).json({ message: "Le texte est obligatoire" });
      if (text.length > 180) {
        return res.status(400).json({ message: "Le texte ne peut pas dépasser 180 caractères" });
      }
      item.text = text;
    }

    if (req.body.marker !== undefined) item.marker = pickMarker(req.body.marker, item.marker);
    if (req.body.accent !== undefined) item.accent = pickAccent(req.body.accent, item.accent);
    if (req.body.order !== undefined) item.order = parseInt(req.body.order) || 0;
    if (req.body.active !== undefined) item.active = parseBool(req.body.active, item.active);

    res.json(await repo.save(item));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

/** DELETE /api/announcements/:id */
exports.remove = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(Announcement);
    const item = await repo.findOneBy({ id: parseInt(req.params.id) });
    if (!item) return res.status(404).json({ message: "Annonce introuvable" });
    await repo.remove(item);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * PUT /api/announcements/reorder
 * Body: { items: [{ id, order }, …] } — lets the admin drag rows without
 * firing one request per row.
 */
exports.reorder = async (req, res) => {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (items.length === 0) {
      return res.status(400).json({ message: "Aucun élément à réordonner" });
    }

    const repo = AppDataSource.getRepository(Announcement);
    await Promise.all(
      items.map(({ id, order }) =>
        repo.update({ id: parseInt(id) }, { order: parseInt(order) || 0 })
      )
    );

    res.json(await repo.find({ order: { order: "ASC", id: "ASC" } }));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

/**
 * POST /api/announcements/seed-defaults
 * Inserts the starter set, but only when the table is still empty — so it can
 * never resurrect messages the admin deliberately deleted.
 */
exports.seedDefaults = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(Announcement);
    const existing = await repo.count();
    if (existing > 0) {
      return res.status(409).json({
        message: `La table contient déjà ${existing} annonce(s) — rien n'a été inséré.`,
      });
    }

    const created = await repo.save(
      DEFAULTS.map((d, i) => repo.create({ ...d, order: i, active: true }))
    );

    res.status(201).json(created);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};
