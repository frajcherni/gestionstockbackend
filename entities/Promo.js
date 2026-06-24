const { EntitySchema } = require("typeorm");

const Promo = new EntitySchema({
  name: "Promo",
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

module.exports = { Promo };
