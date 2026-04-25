const { EntitySchema } = require("typeorm");

const Carousel = new EntitySchema({
    name: "Carousel",
    tableName: "carousels",
    columns: {
        id: { type: "int", primary: true, generated: true },
        image: { type: "varchar", nullable: false },
        title: { type: "varchar", nullable: true },
        subtitle: { type: "varchar", nullable: true },
        link: { type: "varchar", nullable: true },
        order: { type: "int", default: 0 },
        active: { type: "boolean", default: true },
        created_at: { type: "timestamp", createDate: true },
        updated_at: { type: "timestamp", updateDate: true }
    }
});

module.exports = { Carousel };
