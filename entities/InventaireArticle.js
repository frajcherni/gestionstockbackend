// entities/InventaireArticle.js
const { EntitySchema } = require("typeorm");

const InventaireArticle = new EntitySchema({
    name: "InventaireArticle",
    tableName: "inventaire_articles",
    columns: {
        id: { type: "int", primary: true, generated: true },
        inventaire_id: { type: "int", nullable: false },
        article_id: { type: "int", nullable: false },
        qte_reel: { type: "int", nullable: false },
        difference: { type: "int", nullable: false },
        created_at: { type: "timestamp", default: () => "CURRENT_TIMESTAMP" }
    }
});

module.exports = { InventaireArticle };