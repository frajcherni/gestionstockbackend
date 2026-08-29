const { EntitySchema } = require("typeorm");

/**
 * A featured "special offer" — one product with its own headline, copy and
 * countdown, shown as the large banner near the top of the shop's home page.
 *
 * Formerly called Promo; renamed when the discounted-products band took that
 * name. The table is deliberately left as `promos`: `synchronize: true` would
 * treat a changed tableName as a brand-new table and strand every existing
 * row in the old one.
 */
const Offer = new EntitySchema({
  name: "Offer",
  tableName: "promos",
  columns: {
    id: { type: "int", primary: true, generated: true },
    title: { type: "varchar", nullable: false },
    description: { type: "text", nullable: true },
    status: {
      type: "enum",
      enum: ["actif", "inactive"],
      default: "actif",
    },
    date_start: { type: "timestamp", nullable: true },
    date_end: { type: "timestamp", nullable: true },
    order: { type: "int", default: 0 },

    /* ── DISCOUNT ────────────────────────────────────────────────
       A promo can be expressed either way round:
         • discount_percent → the red "-20%" badge, price derived from it
         • promo_price      → the discounted price, badge derived from it
       Whichever the shop owner fills in, the controller returns BOTH
       (plus old_price) so the website never has to compute anything. */
    discount_percent: { type: "int", nullable: true },
    promo_price: { type: "decimal", precision: 10, scale: 3, nullable: true },

    created_at: { type: "timestamp", createDate: true },
    updated_at: { type: "timestamp", updateDate: true },
  },
  relations: {
    product: {
      type: "many-to-one",
      target: "Article",
      eager: true,
      nullable: true,
      joinColumn: { name: "product_id" },
      onDelete: "SET NULL",
    },
  },
});

module.exports = { Offer };
