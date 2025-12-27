// entities/Transfer.js
const { EntitySchema } = require("typeorm");

const TransferItem = new EntitySchema({
  name: "TransferItem",
  tableName: "transfer_items",
  columns: {
    id: { type: "int", primary: true, generated: true },
    transfer_id: { type: "int" },
    article_id: { type: "int" },
    qte: { type: "int", nullable: true },
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
    transfer: {
      type: "many-to-one",
      target: "Transfer",
      joinColumn: { name: "transfer_id" },
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

const Transfer = new EntitySchema({
  name: "Transfer",
  tableName: "transfers",
  columns: {
    id: { type: "int", primary: true, generated: true },
    numero: { type: "varchar", unique: true, nullable: true },
    date: { type: "date", nullable: true },
    date_transfert: { type: "date", nullable: true },
    description: { type: "text", nullable: true },
    depot_source: { type: "varchar", nullable: true },
    depot_destination: { type: "varchar", nullable: true },
    status: {
      type: "enum",
      enum: ["En cours", "Terminé", "Annulé"],
      default: "En cours",
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
      target: "TransferItem",
      inverseSide: "transfer",
      cascade: true,
    },
  },
});

module.exports = { Transfer, TransferItem };
