const { EntitySchema } = require("typeorm");

const EncaissementClient = new EntitySchema({
  name: "EncaissementClient",
  tableName: "encaissements_client",
  columns: {
    id: { primary: true, type: "int", generated: true },
    montant: { type: "decimal", precision: 12, scale: 3 }, // Changed to 3 decimals
    modePaiement: {
      type: "enum",
      enum: ["Espece", "Cheque", "Virement", "Traite", "Autre" , "tpe"],
    },
    numeroEncaissement: { type: "varchar", length: 100, nullable: true },
    date: { type: "date" },
    client_id: { type: "int", nullable: true },
    facture_id: { type: "int", nullable: true },
    // Add new fields for cheque
    numeroCheque: { type: "varchar", length: 100, nullable: true },
    banque: { type: "varchar", length: 100, nullable: true },
    // Add new fields for traite
    numeroTraite: { type: "varchar", length: 100, nullable: true },
    dateEcheance: { type: "date", nullable: true },
    createdAt: { type: "timestamp", createDate: true },
    updatedAt: { type: "timestamp", updateDate: true },
  },
  relations: {
    client: {
      type: "many-to-one",
      target: "Client",
      joinColumn: { name: "client_id" },
      nullable: true,
    },
    factureClient: {
      type: "many-to-one",
      target: "FactureClient",
      joinColumn: { name: "facture_id" },
      nullable: true,
      onDelete: "SET NULL",
    },
  },
});

module.exports = {
  EncaissementClient,
};