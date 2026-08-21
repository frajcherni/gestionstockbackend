const { EntitySchema } = require("typeorm");

/**
 * Single-row table holding the website identity (logo + wordmark).
 * The controller always works on the row with the lowest id and creates it
 * on first read, so the front office never has to deal with an empty table.
 */
const SiteSetting = new EntitySchema({
  name: "SiteSetting",
  tableName: "site_settings",
  columns: {
    id: { type: "int", primary: true, generated: true },
    /** Relative path of the uploaded logo, or null to fall back to the wordmark. */
    logo: { type: "varchar", nullable: true },
    /** Text shown next to (or instead of) the logo. */
    brand_name: { type: "varchar", default: "LUMIÈRE" },
    /** False hides the wordmark so only the uploaded image shows. */
    show_name: { type: "boolean", default: true },
    /** Rendered logo height in px inside the header. */
    logo_height: { type: "int", default: 34 },

    /** Home page promo/newsletter band — title + text over a background image. */
    promo_title: { type: "varchar", default: "Rejoignez le club LUMIÈRE" },
    promo_description: {
      type: "text",
      nullable: true,
      default: "Inscrivez-vous pour accéder en avant-première aux nouveautés, à des offres exclusives et à nos conseils style chaque semaine.",
    },
    /** Relative path of the uploaded background image, or null for the built-in default. */
    promo_image: { type: "varchar", nullable: true },

    /** Footer "About us" block. */
    footer_about_title: { type: "varchar", default: "À propos" },
    /* No DB-level default here: it contains an apostrophe ("l'excellence") that
       TypeORM's schema-sync interpolates unescaped into the raw ALTER TABLE
       DDL, which breaks the SQL. The default is applied in getOrCreate() instead. */
    footer_about_text: { type: "text", nullable: true },

    /** Social links shown in the footer. Icon is hidden when its URL is empty. */
    facebook_url: { type: "varchar", nullable: true },
    instagram_url: { type: "varchar", nullable: true },
    tiktok_url: { type: "varchar", nullable: true },

    created_at: { type: "timestamp", createDate: true },
    updated_at: { type: "timestamp", updateDate: true },
  },
});

module.exports = { SiteSetting };
