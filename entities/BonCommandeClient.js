const { EntitySchema } = require("typeorm");

const BonCommandeClient = new EntitySchema({
  name: "BonCommandeClient",
  tableName: "bon_commande_clients",
  columns: {
    id: { primary: true, type: "int", generated: true },
    numeroCommande: { type: "varchar", unique: true },
    dateCommande: { type: "timestamp" },
    status: {
      type: "enum",
      enum: ["Brouillon", "Confirme", "Livre", "Partiellement Livre", "Annule"],
      default: "Confirme",
    },

    totalTTC: { type: "decimal", precision: 12, scale: 3, default: 0 },
    totalTTCAfterRemise: {
      type: "decimal",
      precision: 12,
      scale: 3,
      default: 0,
    },

    resteAPayer: { type: "decimal", precision: 12, scale: 3, default: 0 },

    // Champs de paiement paiementpaiement
    montantPaye: { type: "decimal", precision: 12, scale: 3, default: 0 },

    hasPayments: { type: "boolean", default: false },
    totalPaymentAmount: {
      type: "decimal",
      precision: 12,
      scale: 3,
      default: 0,
    },
    espaceNotes: { type: "text", nullable: true },

    hasRetenue: { type: "boolean", default: false },
    montantRetenue: { type: "decimal", precision: 12, scale: 3, default: 0 },

    // Stocker les méthodes de paiement en JSON
    paymentMethods: {
      type: "json",
      nullable: true,
      default: null,
    },

    taxMode: {
      type: "enum",
      enum: ["HT", "TTC"],
      default: "HT",
    },
    remise: { type: "decimal", precision: 10, scale: 3, default: 0 },
    remiseType: {
      type: "enum",
      enum: ["percentage", "fixed"],
      default: "percentage",
    },
    notes: { type: "text", nullable: true },
    createdAt: { type: "timestamp", createDate: true },
    updatedAt: { type: "timestamp", updateDate: true },
  },
  relations: {
    client: {
      type: "many-to-one",
      target: "Client",
      eager: true,
      joinColumn: { name: "client_id" },
    },
    clientWebsite: {
      type: "many-to-one",
      target: "ClientWebsite",
      joinColumn: true,
      nullable: true,
    },
    vendeur: {
      type: "many-to-one",
      target: "Vendeur",
      eager: true,
      joinColumn: { name: "vendeur_id" },
    },
    articles: {
      type: "one-to-many",
      target: "BonCommandeClientArticle",
      inverseSide: "bonCommandeClient",
      cascade: true,
      eager: true,
    },
  },
});

const BonCommandeClientArticle = new EntitySchema({
  name: "BonCommandeClientArticle",
  tableName: "bon_commande_client_articles",
  columns: {
    id: { primary: true, type: "int", generated: true },
    quantite: { type: "int" },
    quantiteLivree: {
      type: "int",
      default: 0, // ✅ AJOUTEZ CETTE LIGNE
    },
    prixUnitaire: { type: "decimal", precision: 10, scale: 3 },
    prix_ttc: { type: "decimal", precision: 10, scale: 3, nullable: true },

    tva: {
      type: "decimal",
      precision: 7,
      scale: 3,
      nullable: true,
    },
    remise: {
      type: "decimal",
      precision: 10,
      scale: 3,
      nullable: true,
      default: null,
    },
  },
  relations: {
    bonCommandeClient: {
      type: "many-to-one",
      target: "BonCommandeClient",
      joinColumn: { name: "bon_commande_client_id" },
    },
    article: {
      type: "many-to-one",
      target: "Article",
      eager: true,
      joinColumn: { name: "article_id" },
    },
  },
});

module.exports = {
  BonCommandeClient,
  BonCommandeClientArticle,
};
