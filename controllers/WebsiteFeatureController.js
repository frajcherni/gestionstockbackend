const { AppDataSource } = require("../db");
const { WebsiteFeature } = require("../entities/WebsiteFeature");

const parseBool = (v, fallback) =>
  v !== undefined ? v === "true" || v === true : fallback;

/** Icon keys the website knows how to draw. Anything else falls back to "shield". */
const ICONS = [
  "shield", "grid", "sparkles", "headset", "truck", "award", "leaf",
  "clock", "credit-card", "gift", "wrench", "heart", "star", "package",
];
const safeIcon = (v) => (ICONS.includes(v) ? v : "shield");

/**
 * Seeded on first read so a fresh install already shows a complete strip
 * instead of a blank band; the shop owner edits or deletes these freely.
 */
const DEFAULTS = [
  { icon: "award",    title: "Produits de qualité",   description: "Des produits sélectionnés pour leur qualité et leur durabilité.", order: 0 },
  { icon: "grid",     title: "Large choix",           description: "Un large choix de luminaires, mobilier et décoration.",           order: 1 },
  { icon: "sparkles", title: "Styles pour tous",      description: "Du moderne au classique, pour tous les goûts.",                   order: 2 },
  { icon: "headset",  title: "Conseils personnalisés", description: "Notre équipe est à votre écoute pour vous guider.",              order: 3 },
  { icon: "truck",    title: "Livraison rapide",      description: "Livraison rapide et sécurisée partout en Tunisie.",               order: 4 },
];

exports.getAll = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(WebsiteFeature);
    let items = await repo.find({ order: { order: "ASC", id: "ASC" } });
    if (items.length === 0) {
      await repo.save(DEFAULTS.map((d) => repo.create({ ...d, active: true })));
      items = await repo.find({ order: { order: "ASC", id: "ASC" } });
    }
    const activeOnly = req.query.active === "true";
    res.json(activeOnly ? items.filter((i) => i.active) : items);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(WebsiteFeature);
    if (!req.body.title) {
      return res.status(400).json({ message: "Le titre est obligatoire" });
    }
    const saved = await repo.save(
      repo.create({
        icon: safeIcon(req.body.icon),
        title: req.body.title,
        description: req.body.description || null,
        order: parseInt(req.body.order) || 0,
        active: parseBool(req.body.active, true),
      })
    );
    res.status(201).json(saved);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(WebsiteFeature);
    const item = await repo.findOneBy({ id: parseInt(req.params.id) });
    if (!item) return res.status(404).json({ message: "Élément introuvable" });

    if (req.body.icon !== undefined) item.icon = safeIcon(req.body.icon);
    if (req.body.title !== undefined) item.title = req.body.title;
    if (req.body.description !== undefined) item.description = req.body.description || null;
    if (req.body.order !== undefined) item.order = parseInt(req.body.order) || 0;
    item.active = parseBool(req.body.active, item.active);

    res.json(await repo.save(item));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(WebsiteFeature);
    const item = await repo.findOneBy({ id: parseInt(req.params.id) });
    if (!item) return res.status(404).json({ message: "Élément introuvable" });
    await repo.remove(item);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
