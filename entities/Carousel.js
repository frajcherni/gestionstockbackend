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
        btn_label: { type: "varchar", nullable: true },
        btn_color: { type: "varchar", nullable: true },
        btn2_label: { type: "varchar", nullable: true },
        btn2_link: { type: "varchar", nullable: true },
        btn2_color: { type: "varchar", nullable: true },
        description: { type: "text", nullable: true },
        tag_color: { type: "varchar", nullable: true },
        title_color: { type: "varchar", nullable: true },
        description_color: { type: "varchar", nullable: true },
        btn1_text_color: { type: "varchar", nullable: true },
        btn2_text_color: { type: "varchar", nullable: true },
        show_text: { type: "boolean", default: true },
        show_btn1: { type: "boolean", default: true },
        show_btn2: { type: "boolean", default: true },
        order: { type: "int", default: 0 },
        active: { type: "boolean", default: true },
        created_at: { type: "timestamp", createDate: true },
        updated_at: { type: "timestamp", updateDate: true }
    }
});

module.exports = { Carousel };
