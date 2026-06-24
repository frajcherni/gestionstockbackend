const { EntitySchema } = require("typeorm");

const Testimonial = new EntitySchema({
  name: "Testimonial",
  tableName: "testimonials",
  columns: {
    id: { type: "int", primary: true, generated: true },
    image: { type: "varchar", nullable: false },
    name: { type: "varchar", nullable: true },
    order: { type: "int", default: 0 },
    active: { type: "boolean", default: true },
    created_at: { type: "timestamp", createDate: true },
    updated_at: { type: "timestamp", updateDate: true },
  },
});

module.exports = { Testimonial };
