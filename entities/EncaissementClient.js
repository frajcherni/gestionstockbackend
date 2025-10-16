const { EntitySchema } = require("typeorm");

const EncaissementClient = new EntitySchema({
  name: "EncaissementClient",
  tableName: "encaissements_client",
  columns: {
    id: { primary: true, type: "int", generated: true },
    montant: { type: "decimal", precision: 12, scale: 2 },
    modePaiement: {
      type: "enum",
      enum: ["Espece", "Cheque", "Virement", "Traite", "Autre"],
    },
    numeroEncaissement: { type: "varchar", length: 100, nullable: true },
    date: { type: "date" },
    client_id: { type: "int", nullable: true }, // Required
    facture_id: { type: "int", nullable: true }, // Optional
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
