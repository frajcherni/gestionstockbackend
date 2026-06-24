const { AppDataSource } = require("../db");
const { Promo } = require("../entities/Promo");

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────
function toRelativePath(p) {
  if (!p) return null;
  const s = p.replace(/\\/g, "/");
  const match = s.match(/uploads\/.*/i);
  return match ? match[0] : s;
}

// Normalize the embedded product image so the website gets a relative path
function formatPromo(promo) {
  if (!promo) return promo;
  const out = { ...promo };
  if (out.product && out.product.image) {
    out.product = { ...out.product, image: toRelativePath(out.product.image) };
  }
  return out;
}

function isWithinDateRange(promo, now = new Date()) {
  const start = promo.date_start ? new Date(promo.date_start) : null;
  const end = promo.date_end ? new Date(promo.date_end) : null;
  if (start && now < start) return false;
  if (end && now > end) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────
// CONTROLLERS
// ─────────────────────────────────────────────────────────────────

// ERP: all promos (any status)
exports.getAll = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(Promo);
    const promos = await repo.find({ order: { order: "ASC", id: "DESC" } });
    res.json(promos.map(formatPromo));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// WEBSITE: only active promos that are currently within their date range
exports.getActive = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(Promo);
    const promos = await repo.find({
      where: { status: "actif" },
      order: { order: "ASC", id: "DESC" },
    });
    const now = new Date();
    const visible = promos
      .filter((p) => p.product) // must have a linked product
      .filter((p) => isWithinDateRange(p, now))
      .map(formatPromo);
    res.json(visible);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(Promo);
    const {
      title,
      description,
      status,
      date_start,
      date_end,
      order,
      product_id,
    } = req.body;

    if (!title) return res.status(400).json({ message: "Le titre est obligatoire" });
    if (!product_id) return res.status(400).json({ message: "Le produit est obligatoire" });

    const data = {
      title,
      description: description || null,
      status: status === "inactive" ? "inactive" : "actif",
      date_start: date_start ? new Date(date_start) : null,
      date_end: date_end ? new Date(date_end) : null,
      order: parseInt(order) || 0,
      product: { id: parseInt(product_id) },
    };

    const saved = await repo.save(repo.create(data));
    const full = await repo.findOne({ where: { id: saved.id } });
    res.status(201).json(formatPromo(full));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(Promo);
    const id = parseInt(req.params.id);
    const item = await repo.findOne({ where: { id } });
    if (!item) return res.status(404).json({ message: "Promo introuvable" });

    const {
      title,
      description,
      status,
      date_start,
      date_end,
      order,
      product_id,
    } = req.body;

    if (title !== undefined) item.title = title;
    if (description !== undefined) item.description = description || null;
    if (status !== undefined) item.status = status === "inactive" ? "inactive" : "actif";
    if (date_start !== undefined) item.date_start = date_start ? new Date(date_start) : null;
    if (date_end !== undefined) item.date_end = date_end ? new Date(date_end) : null;
    if (order !== undefined) item.order = parseInt(order) || 0;
    if (product_id !== undefined) item.product = product_id ? { id: parseInt(product_id) } : null;

    await repo.save(item);
    const full = await repo.findOne({ where: { id } });
    res.json(formatPromo(full));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(Promo);
    const id = parseInt(req.params.id);
    const item = await repo.findOne({ where: { id } });
    if (!item) return res.status(404).json({ message: "Promo introuvable" });
    await repo.remove(item);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
