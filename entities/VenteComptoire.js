const { EntitySchema } = require("typeorm");

const VenteComptoire = new EntitySchema({
    name: "VenteComptoire",
    tableName: "vente_comptoire",
    columns: {
        id: { primary: true, type: "int", generated: true },
        numeroCommande: { type: "varchar", unique: true },
        dateCommande: { type: "timestamp" },
        status: {
            type: "enum",
            enum: ["Brouillon", "Confirme", "Livre", "Partiellement Livre", "Annule"],
            default: "Confirme"
        },
        taxMode: {
            type: "enum",
            enum: ["HT", "TTC"],
            default: "HT"
        },
        remise: { type: "decimal", precision: 10, scale: 3, default: 0 },
        totalAfterRemise: { type: "decimal", precision: 12, scale: 3, default: 0 },
        remiseType: {
            type: "enum",
            enum: ["percentage", "fixed"],
            default: "percentage"
        },
        notes: { type: "text", nullable: true },
        // ✅ ADD PAYMENT FIELDS
        paymentMethods: { 
            type: "json", 
            nullable: true 
        },
        totalPaymentAmount: { 
            type: "decimal", 
            precision: 12, 
            scale: 3, 
            default: 0 
        },
        espaceNotes: { type: "text", nullable: true },
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
            target: "VenteComptoireArticle",
            inverseSide: "venteComptoire",
            cascade: true,
            eager: true
        }
    }
});

const VenteComptoireArticle = new EntitySchema({
    name: "VenteComptoireArticle",
    tableName: "vente_comptoire_articles",
    columns: {
        id: { primary: true, type: "int", generated: true },
        quantite: { type: "int" },
        prixUnitaire: { type: "decimal", precision: 10, scale: 3 },
        prix_ttc: { type: "decimal", precision: 10, scale: 3 , nullable : true },
        fodec: { type: "boolean", default: false , nullable : true},

        tva: { type: "decimal", precision: 5, scale: 3, nullable: true },
        remise: { type: "decimal", precision: 5, scale: 3, nullable: true, default: null }
    },
    relations: {
        venteComptoire: {
            type: "many-to-one",
            target: "VenteComptoire",
            joinColumn: { name: "vente_comptoire_id" }
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
    VenteComptoire,
    VenteComptoireArticle
};