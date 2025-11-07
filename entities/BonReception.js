const { EntitySchema } = require("typeorm");

const BonReception = new EntitySchema({
  name: "BonReception",
  tableName: "bon_receptions",
  columns: {
    id: { primary: true, type: "int", generated: true },
    numeroReception: { type: "varchar", unique: true },
    dateReception: { type: "timestamp" },
    status: {
      type: "enum",
      enum: ["Brouillon", "Recu", "Partiellement Recu", "Annule"],
      default: "Recu",
    },
    notes: { type: "text", nullable: true },
    remise: { type: "decimal", precision: 10, scale: 3, default: 0 },
    remiseType: {
      type: "enum",
      enum: ["percentage", "fixed"],
      default: "percentage",
    },
    createdAt: { type: "timestamp", createDate: true },
    updatedAt: { type: "timestamp", updateDate: true },
  },
  relations: {
    bonCommande: {
      type: "many-to-one",
      target: "BonCommande",
      eager: true,
      joinColumn: { name: "bon_commande_id" },
      nullable: true,
    },
    fournisseur: {
      type: "many-to-one",
      target: "Fournisseur",
      eager: true,
      joinColumn: { name: "fournisseur_id" },
      nullable: true,
    },
    articles: {
      type: "one-to-many",
      target: "BonReceptionArticle",
      inverseSide: "bonReception",
      cascade: true,
      eager: true,
    },
  },
});

const BonReceptionArticle = new EntitySchema({
  name: "BonReceptionArticle",
  tableName: "bon_reception_articles",
  columns: {
    id: { primary: true, type: "int", generated: true },
    quantite: { type: "int" },
    prixUnitaire: { type: "decimal", precision: 10, scale: 3 },
    tva: {
      type: "decimal",
      precision: 5,
      scale: 3,
      nullable: true,
    },
    remise: {
      type: "decimal",
      precision: 5,
      scale: 3,
      nullable: true,
      default: null,
    },
  },
  relations: {
    bonReception: {
      type: "many-to-one",
      target: "BonReception",
      joinColumn: { name: "bon_reception_id" },
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
  BonReception,
  BonReceptionArticle,
};
