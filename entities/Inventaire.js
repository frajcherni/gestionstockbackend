// entities/Inventaire.js
const { EntitySchema } = require("typeorm");

const InventaireItem = new EntitySchema({
  name: "InventaireItem",
  tableName: "inventaire_items",
  columns: {
    id: { type: "int", primary: true, generated: true },
    inventaire_id: { type: "int", nullable: true },
    article_id: { type: "int", nullable: true },
    qte_reel: { type: "int", nullable: true },
    pua_ht: { type: "decimal", precision: 10, scale: 3, nullable: true },
    pua_ttc: { type: "decimal", precision: 10, scale: 3, nullable: true },
    tva: { type: "decimal", precision: 5, scale: 2, nullable: true },
    total_tva: { type: "decimal", precision: 12, scale: 3, nullable: true },
    total_ht: { type: "decimal", precision: 12, scale: 3, nullable: true },
    total_ttc: { type: "decimal", precision: 12, scale: 3, nullable: true },
    created_at: { type: "timestamp", default: () => "CURRENT_TIMESTAMP" },
    updated_at: {
      type: "timestamp",
      default: () => "CURRENT_TIMESTAMP",
      onUpdate: "CURRENT_TIMESTAMP",
    },
  },
  relations: {
    inventaire: {
      type: "many-to-one",
      target: "Inventaire",
      joinColumn: { name: "inventaire_id" },
      nullable: true,
    },
    article: {
      type: "many-to-one",
      target: "Article",
      joinColumn: { name: "article_id" },
      eager: true,
      nullable: true,
    },
  },
});

const Inventaire = new EntitySchema({
  name: "Inventaire",
  tableName: "inventaires",
  columns: {
    id: { type: "int", primary: true, generated: true },
    numero: { type: "varchar", unique: true, nullable: true },
    date: { type: "date", nullable: true },
    date_inventaire: { type: "date", nullable: true },
    description: { type: "text", nullable: true },
    depot: { type: "varchar", nullable: true }, // CHANGED FROM ENUM TO VARCHAR
    status: {
      type: "enum",
      enum: ["En cours", "Terminé", "Annulé"],
      default: "Terminé",
      nullable: true,
    },
    total_ht: { type: "decimal", precision: 12, scale: 3, default: 0 },
    total_ttc: { type: "decimal", precision: 12, scale: 3, default: 0 },
    total_tva: { type: "decimal", precision: 12, scale: 3, default: 0 },
    article_count: { type: "int", default: 0 },
    created_at: { type: "timestamp", default: () => "CURRENT_TIMESTAMP" },
    updated_at: {
      type: "timestamp",
      default: () => "CURRENT_TIMESTAMP",
      onUpdate: "CURRENT_TIMESTAMP",
    },
  },
  relations: {
    items: {
      type: "one-to-many",
      target: "InventaireItem",
      inverseSide: "inventaire",
      cascade: true,
    },
    
  },
});

module.exports = { Inventaire, InventaireItem };