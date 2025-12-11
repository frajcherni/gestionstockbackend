const { EntitySchema } = require("typeorm");

const Inventaire = new EntitySchema({
  name: "Inventaire",
  tableName: "inventaires",
  columns: {
    id: { primary: true, type: "int", generated: true },
    numeroInventaire: {
      type: "varchar",
      unique: true,
      default: () =>
        `INV-${new Date().getFullYear()}-${Math.floor(Math.random() * 10000)
          .toString()
          .padStart(4, "0")}`,
    },
    dateInventaire: {
      type: "timestamp",
      default: () => "CURRENT_TIMESTAMP",
    },
    notes: { type: "text", nullable: true },
    totalArticles: { type: "int", default: 0 },
    createdAt: { type: "timestamp", createDate: true },
    updatedAt: { type: "timestamp", updateDate: true },
  },
  relations: {
    articles: {
      type: "one-to-many",
      target: "InventaireArticle",
      inverseSide: "inventaire",
      cascade: true,
    },
  },
});

const InventaireArticle = new EntitySchema({
  name: "InventaireArticle",
  tableName: "inventaire_articles",
  columns: {
    id: { primary: true, type: "int", generated: true },
    quantite: { type: "int" }, // Just one quantity field as requested
    prixAchatHT: { type: "decimal", precision: 10, scale: 3, nullable: true },
    prixAchatTTC: { type: "decimal", precision: 10, scale: 3, nullable: true },
    tva: {
      type: "decimal",
      precision: 7,
      scale: 3,
      nullable: true,
      default: null,
    },
    isConsigne: { type: "boolean", default: false },
    montantHT: { type: "decimal", precision: 12, scale: 3, default: 0 },
    montantTTC: { type: "decimal", precision: 12, scale: 3, default: 0 },
    montantTVA: { type: "decimal", precision: 12, scale: 3, default: 0 },
  },
  relations: {
    inventaire: {
      type: "many-to-one",
      target: "Inventaire",
      joinColumn: { name: "inventaire_id" },
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
  Inventaire,
  InventaireArticle,
};
