const { AppDataSource } = require("../db");
const { Offer } = require("../entities/Offer");
const { toNumber, resolveDiscount, toRelativePath } = require("../utils/discountUtils");

// Normalize the embedded product image so the website gets a relative path,
// and expose the resolved discount alongside the raw columns.
function formatOffer(offer) {
  if (!offer) return offer;
  const out = { ...offer };
  if (out.product && out.product.image) {
    out.product = { ...out.product, image: toRelativePath(out.product.image) };
  }
  const { old_price, final_price, discount_percent } = resolveDiscount(out, offer?.product?.puv_ttc);
  out.old_price = old_price;
  out.final_price = final_price;
  out.discount_percent = discount_percent;
  return out;
}

function isWithinDateRange(offer, now = new Date()) {
  const start = offer.date_start ? new Date(offer.date_start) : null;
  const end = offer.date_end ? new Date(offer.date_end) : null;
  if (start && now < start) return false;
  if (end && now > end) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────
// CONTROLLERS
// ─────────────────────────────────────────────────────────────────

// ERP: all offers (any status)
exports.getAll = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(Offer);
    const offers = await repo.find({ order: { order: "ASC", id: "DESC" } });
    res.json(offers.map(formatOffer));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// WEBSITE: only active offers that are currently within their date range
exports.getActive = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(Offer);
    const offers = await repo.find({
      where: { status: "actif" },
      order: { order: "ASC", id: "DESC" },
    });
    const now = new Date();
    const visible = offers
      .filter((p) => p.product) // must have a linked product
      .filter((p) => isWithinDateRange(p, now))
      .map(formatOffer);
    res.json(visible);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(Offer);
    const {
      title,
      description,
      status,
      date_start,
      date_end,
      order,
      product_id,
      discount_percent,
      promo_price,
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
      discount_percent: toNumber(discount_percent),
      promo_price: toNumber(promo_price),
      product: { id: parseInt(product_id) },
    };

    const saved = await repo.save(repo.create(data));
    const full = await repo.findOne({ where: { id: saved.id } });
    res.status(201).json(formatOffer(full));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(Offer);
    const id = parseInt(req.params.id);
    const item = await repo.findOne({ where: { id } });
    if (!item) return res.status(404).json({ message: "Offre introuvable" });

    const {
      title,
      description,
      status,
      date_start,
      date_end,
      order,
      product_id,
      discount_percent,
      promo_price,
    } = req.body;

    if (title !== undefined) item.title = title;
    if (description !== undefined) item.description = description || null;
    if (status !== undefined) item.status = status === "inactive" ? "inactive" : "actif";
    if (date_start !== undefined) item.date_start = date_start ? new Date(date_start) : null;
    if (date_end !== undefined) item.date_end = date_end ? new Date(date_end) : null;
    if (order !== undefined) item.order = parseInt(order) || 0;
    if (discount_percent !== undefined) item.discount_percent = toNumber(discount_percent);
    if (promo_price !== undefined) item.promo_price = toNumber(promo_price);
    if (product_id !== undefined) item.product = product_id ? { id: parseInt(product_id) } : null;

    await repo.save(item);
    const full = await repo.findOne({ where: { id } });
    res.json(formatOffer(full));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(Offer);
    const id = parseInt(req.params.id);
    const item = await repo.findOne({ where: { id } });
    if (!item) return res.status(404).json({ message: "Offre introuvable" });
    await repo.remove(item);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
