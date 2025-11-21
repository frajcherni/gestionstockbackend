const { EntitySchema } = require("typeorm");

const DevisClient = new EntitySchema({
    name: "DevisClient",
    tableName: "devis_clients", // renamed table
    columns: {
        id: { primary: true, type: "int", generated: true },
        numeroCommande: { type: "varchar", unique: true }, // keep same name for compatibility
        dateCommande: { type: "timestamp" },
        status: {
            type: "enum",
            enum: ["Confirme", "Envoye", "Accepte", "Refuse", "Expire" , "Brouillon"],
            default: "Brouillon"
        },
        taxMode: {
            type: "enum",
            enum: ["HT", "TTC"],
            default: "HT"
        },
        remise: { type: "decimal", precision: 10, scale: 3, default: 0 },
        remiseType: {
            type: "enum",
            enum: ["percentage", "fixed"],
            default: "percentage"
        },
        notes: { type: "text", nullable: true },
        createdAt: { type: "timestamp", createDate: true },
        updatedAt: { type: "timestamp", updateDate: true }
    },
    relations: {
        client: {
            type: "many-to-one",
            target: "Client",
            eager: true,
            joinColumn: { name: "client_id" }
        },
        vendeur: {
            type: "many-to-one",
            target: "Vendeur",
            eager: true,
            joinColumn: { name: "vendeur_id" }
        },
        articles: {
            type: "one-to-many",
            target: "DevisClientArticle",
            inverseSide: "devisClient",
            cascade: true,
            eager: true
        }
    }
});

const DevisClientArticle = new EntitySchema({
    name: "DevisClientArticle",
    tableName: "devis_client_articles",
    columns: {
        id: { primary: true, type: "int", generated: true },
        quantite: { type: "int" },
        prixUnitaire: { type: "decimal", precision: 10, scale: 3 },
        prix_ttc: { type: "decimal", precision: 10, scale: 3 , nullable : true },

        tva: {
            type: "decimal",
            precision: 5,
            scale: 3,
            nullable: true
        },
        remise: {
            type: "decimal",
            precision: 5,
            scale: 3,
            nullable: true,
            default: null
        }
    },
    relations: {
        devisClient: {
            type: "many-to-one",
            target: "DevisClient",
            joinColumn: { name: "devis_client_id" }
        },
        article: {
            type: "many-to-one",
            target: "Article",
            eager: true,
            joinColumn: { name: "article_id" }
        }
    }
});

module.exports = {
    DevisClient,
    DevisClientArticle
};
