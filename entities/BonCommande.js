const { EntitySchema } = require("typeorm");

const BonCommande = new EntitySchema({
  name: "BonCommande",
  tableName: "bon_commandes",
  columns: {
    id: { primary: true, type: "int", generated: true },
    numeroCommande: { type: "varchar", unique: true },
    dateCommande: { type: "timestamp", createDate: true },
    status: {
      type: "enum",
      enum: ["Brouillon", "Confirme", "Annule", "Partiellement Recu", "Recu"],
      default: "Confirme",
    },
    taxMode: {
      type: "enum",
      enum: ["HT", "TTC"],
      default: "HT",
    },
    montant_fodec: { type: "decimal", precision: 10, scale: 3, default: 0 },
    remise: { type: "decimal", precision: 10, scale: 3, default: 0 },
    remiseType: {
      type: "enum",
      enum: ["percentage", "fixed"],
      default: "percentage",
    },
    totalHT: { type: "decimal", precision: 10, scale: 3, default: 0 },
    totalTVA: { type: "decimal", precision: 10, scale: 3, default: 0 },
    totalTTC: { type: "decimal", precision: 10, scale: 3, default: 0 },
    notes: { type: "text", nullable: true },
    createdAt: { type: "timestamp", createDate: true },
    updatedAt: { type: "timestamp", updateDate: true },
  },
  relations: {
    fournisseur: {
      type: "many-to-one",
      target: "Fournisseur",
      eager: true,
      joinColumn: { name: "fournisseur_id" },
    },
    articles: {
      type: "one-to-many",
      target: "BonCommandeArticle",
      inverseSide: "bonCommande",
      cascade: true,
      eager: true,
    },
  },
});

const BonCommandeArticle = new EntitySchema({
  name: "BonCommandeArticle",
  tableName: "bon_commande_articles",
  columns: {
    id: { primary: true, type: "int", generated: true },
    quantite: { type: "int" },
    prixUnitaire: { type: "decimal", precision: 10, scale: 3 },
    tva: {
      type: "decimal",
      precision: 5,
      scale: 2,
      nullable: true,
    },
    taux_fodec: { type: "boolean" },
    remise: {
      type: "decimal",
      precision: 5,
      scale: 2,
      nullable: true,
      default: null,
    },
  },
  relations: {
    bonCommande: {
      type: "many-to-one",
      target: "BonCommande",
      joinColumn: { name: "bon_commande_id" },
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
  BonCommande,
  BonCommandeArticle,
};
