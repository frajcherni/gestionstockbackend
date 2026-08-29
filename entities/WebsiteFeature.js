const { EntitySchema } = require("typeorm");

/**
 * One cell of the reassurance strip on the home page — the row of icons
 * reading "Produits de qualité · Large choix · Styles pour tous · …".
 *
 * `icon` is a key from a fixed list the website maps to a Lucide glyph
 * (see FEATURE_ICONS in the ecommerce api.ts and the ERP picker), so the
 * shop owner never has to paste SVG markup.
 */
const WebsiteFeature = new EntitySchema({
  name: "WebsiteFeature",
  tableName: "website_features",
  columns: {
    id: { type: "int", primary: true, generated: true },
    icon: { type: "varchar", default: "shield" },
    title: { type: "varchar", nullable: false },
    description: { type: "text", nullable: true },
    order: { type: "int", default: 0 },
    active: { type: "boolean", default: true },
    created_at: { type: "timestamp", createDate: true },
    updated_at: { type: "timestamp", updateDate: true },
  },
});

module.exports = { WebsiteFeature };
