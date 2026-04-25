// src/entities/Categorie.js
const { EntitySchema } = require("typeorm");

const Categorie = new EntitySchema({
  name: "Categorie",
  tableName: "categories",
  columns: {
    id: { primary: true, type: "int", generated: true },
    nom: { type: "varchar", length: 100 },
    description: { type: "text", nullable: true },
    parent_id: { type: "int", nullable: true }, // MAKE SURE THIS EXISTS
    createdAt: { type: "timestamp", createDate: true },
    updatedAt: { type: "timestamp", updateDate: true },
    image: { type: "varchar", nullable: true }, // ADD THIS LINE
    on_website: { type: "boolean", default: false, nullable: true },
    website_order: { type: "int", default: 0, nullable: true },
  }
});

module.exports = { Categorie };


