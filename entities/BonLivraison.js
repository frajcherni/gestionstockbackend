const { EntitySchema } = require("typeorm");

const BonLivraison = new EntitySchema({
  name: "BonLivraison",
  tableName: "bon_livraisons",
  columns: {
    id: { primary: true, type: "int", generated: true },
    numeroLivraison: { type: "varchar", unique: true },
    dateLivraison: { type: "timestamp" },
    status: {
      type: "enum",
      enum: ["Brouillon", "Livré", "Partiellement Livré", "Annule"], // ✅ MODIFIEZ LES STATUTS
      default: "Livré",
    },
    remise: { type: "decimal", precision: 18, scale: 10, default: 0 },
    lockedPercentage: { type: "decimal", precision: 18, scale: 10, nullable: true, default: null },
    remiseType: {
      type: "enum",
      enum: ["percentage", "fixed"],
      default: "percentage",
    },
    notes: { type: "text", nullable: true },
    voiture: { type: "varchar", nullable: true },
    serie: { type: "varchar", nullable: true },
    chauffeur: { type: "varchar", nullable: true },
    cin: { type: "varchar", nullable: true },
    taxMode: {
      type: "enum",
      enum: ["HT", "TTC"],
      default: "HT",
    },
    totalHT: { type: "decimal", precision: 12, scale: 3, default: 0 },
    totalTVA: { type: "decimal", precision: 12, scale: 3, default: 0 },
    totalTTC: { type: "decimal", precision: 12, scale: 3, default: 0 },
    totalTTCAfterRemise: {
      type: "decimal",
      precision: 12,
      scale: 3,
      default: 0,
    },

    resteAPayer: { type: "decimal", precision: 12, scale: 3, default: 0 },

    // Champs de paiement
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
    vendeur: {
      type: "many-to-one",
      target: "Vendeur",
      eager: true,
      joinColumn: { name: "vendeur_id" },
    },
    depot: {
      type: "many-to-one",
      target: "Depot",
      eager: true,
      joinColumn: { name: "depot_id" },
    },
    bonCommandeClient: {
      type: "many-to-one",
      target: "BonCommandeClient",
      nullable: true,
      joinColumn: { name: "bon_commande_client_id" },
    },
    articles: {
      type: "one-to-many",
      target: "BonLivraisonArticle",
      inverseSide: "bonLivraison",
      cascade: true,
      eager: true,
    },
    paiements: {
      type: "one-to-many",
      target: "PaiementClient",
      inverseSide: "bonLivraison",
    },
    factures: {
      type: "one-to-many",
      target: "FactureClient",
      inverseSide: "bonLivraison",
    },
  },
});

const BonLivraisonArticle = new EntitySchema({
  name: "BonLivraisonArticle",
  tableName: "bon_livraison_articles",
  columns: {
    id: { primary: true, type: "int", generated: true },
    quantite: { type: "int" },
    prix_unitaire: { type: "decimal", precision: 10, scale: 3 },
    prix_ttc: { type: "decimal", precision: 10, scale: 3, nullable: true },
    designation: { type: "varchar", length: 500, nullable: true }, // ADD THIS LINE
    // Add this

    tva: { type: "decimal", precision: 7, scale: 3, nullable: true },
    remise: {
      type: "decimal",
      precision: 10,
      scale: 3,
      nullable: true,
      default: null,
    },
  },
  relations: {
    bonLivraison: {
      type: "many-to-one",
      target: "BonLivraison",
      joinColumn: { name: "bon_livraison_id" },
    },
    article: {
      type: "many-to-one",
      target: "Article",
      eager: true,
      joinColumn: { name: "article_id" },
    },
  },
});

module.exports = { BonLivraison, BonLivraisonArticle };
