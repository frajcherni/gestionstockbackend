const { EntitySchema } = require("typeorm");

/**
 * Journal des sorties de stock (ventes, livraisons, etc.)
 * Permet de filtrer les quantités sorties par date et par document.
 */
const JournalSortieArticle = new EntitySchema({
  name: "JournalSortieArticle",
  tableName: "journal_sortie_articles",
  columns: {
    id: { type: "int", primary: true, generated: true },
    article_id: { type: "int" },
    depot_id: { type: "int", nullable: true },
    quantite: { type: "int" },
    date_sortie: { type: "date" },
    type_document: {
      type: "varchar",
      length: 50,
      comment:
        "vente_comptoire | bon_livraison | bon_commande_client | facture_client | correction | autre",
    },
    document_id: { type: "int", nullable: true },
    numero_document: { type: "varchar", length: 100, nullable: true },
    commentaire: { type: "text", nullable: true },
    created_at: {
      type: "timestamp",
      default: () => "CURRENT_TIMESTAMP",
    },
  },
  indices: [
    { name: "IDX_JSA_DATE", columns: ["date_sortie"] },
    { name: "IDX_JSA_ARTICLE", columns: ["article_id"] },
    { name: "IDX_JSA_DEPOT", columns: ["depot_id"] },
    { name: "IDX_JSA_TYPE_DOC", columns: ["type_document", "document_id"] },
  ],
  relations: {
    article: {
      type: "many-to-one",
      target: "Article",
      joinColumn: { name: "article_id" },
      eager: true,
    },
    depot: {
      type: "many-to-one",
      target: "Depot",
      joinColumn: { name: "depot_id" },
      nullable: true,
    },
  },
});

module.exports = { JournalSortieArticle };
