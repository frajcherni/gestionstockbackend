const { AppDataSource } = require("../db");
const { Promo, PromoItem } = require("../entities/Promo");
const { toNumber, resolveDiscount, toRelativePath } = require("../utils/discountUtils");

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

/**
 * Shapes one campaign for the client: relative image paths, and every item's
 * discount resolved to the three figures the card needs (badge percentage,
 * price paid, price struck through).
 */
function formatPromo(promo) {
  if (!promo) return promo;
  const items = (promo.items || [])
    .filter((item) => item.article)
    .sort((a, b) => (a.order || 0) - (b.order || 0) || a.id - b.id)
    .map((item) => {
      const article = { ...item.article, image: toRelativePath(item.article.image) };
      const { old_price, final_price, discount_percent } = resolveDiscount(
        item,
        article.puv_ttc
      );
      return { ...item, article, old_price, final_price, discount_percent };
    });
  return { ...promo, items };
}

function isWithinDateRange(promo, now = new Date()) {
  const start = promo.date_start ? new Date(promo.date_start) : null;
  const end = promo.date_end ? new Date(promo.date_end) : null;
  if (start && now < start) return false;
  if (end && now > end) return false;
  return true;
}

/**
 * Turns the request's `items` array into rows.
 *
 * Accepts either an array or the JSON string a multipart form would send, and
 * drops anything without an article id so a half-filled row in the ERP never
 * reaches the database.
 */
function parseItems(raw) {
  let list = raw;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item && (item.article_id ?? item.article?.id))
    .map((item, index) => ({
      article: { id: parseInt(item.article_id ?? item.article.id) },
      discount_percent: toNumber(item.discount_percent),
      promo_price: toNumber(item.promo_price),
      order: item.order !== undefined ? parseInt(item.order) || 0 : index,
    }));
}

const findFull = (repo, id) => repo.findOne({ where: { id } });

// ─────────────────────────────────────────────────────────────────
// CONTROLLERS
// ─────────────────────────────────────────────────────────────────

// ERP: every campaign, whatever its status
exports.getAll = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(Promo);
    const promos = await repo.find({ order: { order: "ASC", id: "DESC" } });
    res.json(promos.map(formatPromo));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// WEBSITE: active campaigns inside their date range, empty ones dropped
exports.getActive = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(Promo);
    const promos = await repo.find({
      where: { status: "actif" },
      order: { order: "ASC", id: "DESC" },
    });
    const now = new Date();
    const visible = promos
      .filter((p) => isWithinDateRange(p, now))
      .map(formatPromo)
      .filter((p) => p.items.length > 0);
    res.json(visible);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * WEBSITE: every discounted article across all active campaigns, flattened.
 *
 * The home page band shows a single row of products regardless of which
 * campaign they belong to, so it reads this rather than nesting the loop in
 * the browser.
 */
exports.getActiveProducts = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(Promo);
    const promos = await repo.find({
      where: { status: "actif" },
      order: { order: "ASC", id: "DESC" },
    });
    const now = new Date();
    const products = promos
      .filter((p) => isWithinDateRange(p, now))
      .map(formatPromo)
      .flatMap((p) =>
        p.items.map((item) => ({
          id: item.id,
          promo_id: p.id,
          promo_title: p.title,
          article: item.article,
          old_price: item.old_price,
          final_price: item.final_price,
          discount_percent: item.discount_percent,
          order: item.order,
        }))
      );
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(Promo);
    const { title, status, date_start, date_end, order } = req.body;

    if (!title) return res.status(400).json({ message: "Le titre est obligatoire" });
    const items = parseItems(req.body.items);
    if (items.length === 0) {
      return res.status(400).json({ message: "Ajoutez au moins un article" });
    }

    const saved = await repo.save(
      repo.create({
        title,
        status: status === "inactive" ? "inactive" : "actif",
        date_start: date_start ? new Date(date_start) : null,
        date_end: date_end ? new Date(date_end) : null,
        order: parseInt(order) || 0,
        items,
      })
    );
    res.status(201).json(formatPromo(await findFull(repo, saved.id)));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(Promo);
    const itemRepo = AppDataSource.getRepository(PromoItem);
    const id = parseInt(req.params.id);
    const promo = await findFull(repo, id);
    if (!promo) return res.status(404).json({ message: "Promotion introuvable" });

    const { title, status, date_start, date_end, order } = req.body;
    if (title !== undefined) promo.title = title;
    if (status !== undefined) promo.status = status === "inactive" ? "inactive" : "actif";
    if (date_start !== undefined) promo.date_start = date_start ? new Date(date_start) : null;
    if (date_end !== undefined) promo.date_end = date_end ? new Date(date_end) : null;
    if (order !== undefined) promo.order = parseInt(order) || 0;

    if (req.body.items !== undefined) {
      const items = parseItems(req.body.items);
      if (items.length === 0) {
        return res.status(400).json({ message: "Ajoutez au moins un article" });
      }
      // The rows are replaced wholesale rather than diffed: the ERP form edits
      // the list as a unit, and `cascade` alone would leave the removed rows
      // orphaned with a NOT NULL promo_id.
      const existing = await itemRepo.find({ where: { promo: { id } } });
      if (existing.length > 0) await itemRepo.remove(existing);
      promo.items = items;
    }

    await repo.save(promo);
    res.json(formatPromo(await findFull(repo, id)));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const repo = AppDataSource.getRepository(Promo);
    const id = parseInt(req.params.id);
    const promo = await findFull(repo, id);
    if (!promo) return res.status(404).json({ message: "Promotion introuvable" });
    await repo.remove(promo); // items go with it via onDelete: CASCADE
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
