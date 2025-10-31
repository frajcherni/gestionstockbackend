const { EntitySchema } = require("typeorm");

const FactureClient = new EntitySchema({
  name: "FactureClient",
  tableName: "factures_client",
  columns: {
    id: { primary: true, type: "int", generated: true },
    numeroFacture: { type: "varchar", unique: true },
    dateFacture: { type: "timestamp" },
    dateEcheance: { type: "date", nullable: true },
    timbreFiscal: { type: "boolean", default: false }, // Add timbreFiscal field
    conditionPaiement: { type: "varchar", nullable: true }, // Add conditionPaiement field
    status: {
      type: "enum",
      enum: ["Brouillon", "Validee", "Payee", "Annulee", "Partiellement Payee"],
      default: "Validee",
    },
  
    totalHT: { type: "decimal", precision: 12, scale: 3, default: 0 },
    totalTVA: { type: "decimal", precision: 12, scale: 3, default: 0 },
    totalTTC: { type: "decimal", precision: 12, scale: 3, default: 0 },
    notes: { type: "text", nullable: true },
    modeReglement: {
      type: "enum",
      enum: ["Espece", "Cheque", "Virement", "Traite", "Autre"],
      nullable: true,
    },
    montantPaye: { type: "decimal", precision: 12, scale: 3, default: 0 },
    resteAPayer: { type: "decimal", precision: 12, scale: 3, default: 0 },
    remise: {
      type: "decimal",
      precision: 12,
      scale: 3,
      default: 0,
      nullable: true,
    },
    remiseType: {
      type: "enum",
      enum: ["percentage", "fixed"],
      default: "percentage",
      nullable: true,
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
      nullable: false,
    },
    bonLivraison: {
      type: "many-to-one",
      target: "BonLivraison",
      eager: true,
      joinColumn: { name: "bon_livraison_id" },
      nullable: true,
    },
    articles: {
      type: "one-to-many",
      target: "FactureClientArticle",
      inverseSide: "factureClient",
      cascade: true,
      eager: true,
    },
    vendeur: {
      type: "many-to-one",
      target: "Vendeur",
      eager: true,
      joinColumn: { name: "vendeur_id" },
      nullable: true,
    },
  },
});

const FactureClientArticle = new EntitySchema({
  name: "FactureClientArticle",
  tableName: "factures_client_articles",
  columns: {
    id: { primary: true, type: "int", generated: true },
    quantite: { type: "int" },
    prixUnitaire: { type: "decimal", precision: 12, scale: 3 },
    tva: { type: "decimal", precision: 5, scale: 3, nullable: true },
    remise: {
      type: "decimal",
      precision: 5,
      scale: 3,
      nullable: true,
      default: null,
    },
  },
  relations: {
    factureClient: {
      type: "many-to-one",
      target: "FactureClient",
      joinColumn: { name: "facture_client_id" },
      onDelete: "CASCADE",
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
  FactureClient,
  FactureClientArticle,
};
