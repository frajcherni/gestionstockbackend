const { EntitySchema } = require("typeorm");

const FactureFournisseurPayment = new EntitySchema({
  name: "FactureFournisseurPayment",
  tableName: "factures_fournisseur_payments",
  columns: {
    id: { primary: true, type: "int", generated: true },
    montant: { type: "decimal", precision: 12, scale: 3 },
    modePaiement: {
      type: "enum",
      enum: ["Espece", "Cheque", "Virement", "Traite", "Autre"],
    },
    numeroPaiement: { type: "varchar", length: 100, nullable: true },
    datePaiement: { type: "date" },
    facture_id: { type: "int", nullable: true },
    fournisseur_id: { type: "int", nullable: true },
    createdAt: { type: "timestamp", createDate: true },
    updatedAt: { type: "timestamp", updateDate: true },
  },
  relations: {
    factureFournisseur: {
      type: "many-to-one",
      target: "FactureFournisseur",
      joinColumn: { name: "facture_id" },
      nullable: true,
      onDelete: "SET NULL",
    },
    fournisseur: {
      type: "many-to-one",
      target: "Fournisseur",
      joinColumn: { name: "fournisseur_id" },
      nullable: false,
    },
  },
});

module.exports = {
  FactureFournisseurPayment,
};