const { EntitySchema } = require("typeorm");

const Brand = new EntitySchema({
  name: "Brand",
  tableName: "brands",
  columns: {
    id: { type: "int", primary: true, generated: true },
    name: { type: "varchar", nullable: false },
    image: { type: "varchar", nullable: false },
    link: { type: "varchar", nullable: true },
    order: { type: "int", default: 0 },
    active: { type: "boolean", default: true },
    created_at: { type: "timestamp", createDate: true },
    updated_at: { type: "timestamp", updateDate: true },
  },
});

module.exports = { Brand };
