const { EntitySchema } = require("typeorm");

const Article = new EntitySchema({
    name: "Article",
    tableName: "articles",
    columns: {
        id: { type: "int", primary: true , generated:true}, // remove generated:true
        reference: { type: "varchar", nullable: true },
        designation: { type: "varchar", nullable: true },
        pua_ttc: { type: "decimal", precision: 10, scale: 3, nullable: true },
        pua_ht: { type: "decimal", precision: 10, scale: 3, nullable: true },
        puv_ht: { type: "decimal", precision: 10, scale: 3, nullable: true },
        code_barre: { type: "varchar", unique: true, nullable: true }, // NOUVEAU CHAMP

        tva: { type: "int", nullable: true },
        puv_ttc: { type: "decimal", precision: 10, scale: 3, nullable: true },
        type: { type: "varchar", nullable: true },
        qte: { type: "int", nullable: true },
        qte_virtual: { type: "int", default: 0, nullable: true },
        nom: { type: "varchar", nullable: true },
        taux_fodec: { type: "boolean", nullable: true },
        image: { type: "varchar", nullable: true },
        sous_categorie_id: { type: "int", nullable: true },
        on_website: { type: "boolean", default: false, nullable: true },
        is_offre: { type: "boolean", default: false, nullable: true },
        is_top_seller: { type: "boolean", default: false, nullable: true },
        is_new_arrival: { type: "boolean", default: false, nullable: true },
        website_description: { type: "text", nullable: true },
        website_images: { type: "simple-array", nullable: true },
        website_order: { type: "int", default: 0, nullable: true },
    },
    relations: {
        categorie: {
            type: "many-to-one",
            target: "Categorie",
            eager: true,
            joinColumn: { name: "categorie_id" },
            nullable: true
        },
        sousCategorie: {
            type: "many-to-one",
            target: "Categorie",
            eager: true,
            joinColumn: { name: "sous_categorie_id" },
            nullable: true
        },
        stocks: {
            type: "one-to-many",
            target: "StockDepot",
            inverseSide: "article"
        },
        fournisseur: {
            type: "many-to-one",
            target: "Fournisseur",
            eager: true,
            joinColumn: { name: "fournisseur_id" },
            nullable: true
        }
    }
});

module.exports = { Article };
