const { EntitySchema } = require("typeorm");

/**
 * A single message in the scrolling bar above the website header
 * ("Livraison gratuite", "Retours sous 30 jours", …).
 *
 * `marker` picks the decorative glyph rendered before the text and `accent`
 * picks its colour — both are drawn in CSS on the storefront, so no icon
 * library or image upload is involved.
 */
const Announcement = new EntitySchema({
  name: "Announcement",
  tableName: "announcements",
  columns: {
    id: { type: "int", primary: true, generated: true },
    text: { type: "varchar", length: 180, nullable: false },
    // sparkle | diamond | dot | ring | square | bar | plus | slash
    marker: { type: "varchar", length: 24, default: "sparkle" },
    // gold | blue | white
    accent: { type: "varchar", length: 16, default: "gold" },
    order: { type: "int", default: 0 },
    active: { type: "boolean", default: true },
    created_at: { type: "timestamp", createDate: true },
    updated_at: { type: "timestamp", updateDate: true },
  },
});

/** Allowed values, shared with the controller for validation. */
const MARKERS = ["sparkle", "diamond", "dot", "ring", "square", "bar", "plus", "slash"];
const ACCENTS = ["gold", "blue", "white"];

module.exports = { Announcement, MARKERS, ACCENTS };
