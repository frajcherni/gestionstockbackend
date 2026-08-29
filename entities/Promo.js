const { EntitySchema } = require("typeorm");

/**
 * A promotion campaign: a heading plus the articles it discounts.
 *
 * Feeds the "bonnes affaires du moment" band on the shop's home page. Each
 * article carries its own discount (see PromoItem), so one campaign can put
 * several products on sale at different rates.
 *
 * Distinct from Offer, which is the single-product banner with a countdown
 * near the top of the same page — that entity used to be called Promo, which
 * is why it still sits on the `promos` table and this one lives on
 * `website_promos`.
 */
const Promo = new EntitySchema({
  name: "Promo",
  tableName: "website_promos",
  columns: {
    id: { type: "int", primary: true, generated: true },
    /** Internal label, e.g. "Soldes d'été" — not shown on the website. */
    title: { type: "varchar", nullable: false },
    status: {
      type: "enum",
      enum: ["actif", "inactive"],
      default: "actif",
    },
    date_start: { type: "timestamp", nullable: true },
    date_end: { type: "timestamp", nullable: true },
    order: { type: "int", default: 0 },
    created_at: { type: "timestamp", createDate: true },
    updated_at: { type: "timestamp", updateDate: true },
  },
  relations: {
    items: {
      type: "one-to-many",
      target: "PromoItem",
      inverseSide: "promo",
      cascade: true,
      eager: true,
    },
  },
});

/**
 * One discounted article inside a campaign.
 *
 * `discount_percent` and `promo_price` are two ways of saying the same thing;
 * the controller resolves whichever half was left blank, so the website always
 * receives the badge percentage, the price paid and the price struck through.
 */
const PromoItem = new EntitySchema({
  name: "PromoItem",
  tableName: "website_promo_items",
  columns: {
    id: { type: "int", primary: true, generated: true },
    discount_percent: { type: "int", nullable: true },
    promo_price: { type: "decimal", precision: 10, scale: 3, nullable: true },
    order: { type: "int", default: 0 },
  },
  relations: {
    promo: {
      type: "many-to-one",
      target: "Promo",
      joinColumn: { name: "promo_id" },
      onDelete: "CASCADE",
      nullable: false,
    },
    article: {
      type: "many-to-one",
      target: "Article",
      eager: true,
      joinColumn: { name: "article_id" },
      onDelete: "CASCADE",
      nullable: false,
    },
  },
});

module.exports = { Promo, PromoItem };
