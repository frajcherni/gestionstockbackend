const { EntitySchema } = require("typeorm");

const PaiementClient = new EntitySchema({
  name: "PaiementClient",
  tableName: "paiements_client",
  columns: {
    id: { primary: true, type: "int", generated: true },
    montant: { type: "decimal", precision: 12, scale: 3 },
    modePaiement: {
      type: "enum",
      enum: ["Espece", "Cheque", "Virement", "Traite", "Autre"],
    },
    numeroPaiement: { type: "varchar", length: 100, nullable: true },
    date: { type: "date" },
    client_id: { type: "int", nullable: true },
    bonCommandeClient_id: { type: "int", nullable: true },
    // Add new fields for cheque
    numeroCheque: { type: "varchar", length: 100, nullable: true },
    banque: { type: "varchar", length: 100, nullable: true },
    // Add new fields for traite
    numeroTraite: { type: "varchar", length: 100, nullable: true },
    dateEcheance: { type: "date", nullable: true },
    notes: { type: "text", nullable: true },
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
    bonCommandeClient: {
      type: "many-to-one",
      target: "BonCommandeClient",
      joinColumn: { name: "bonCommandeClient_id" },
      nullable: true,
      onDelete: "SET NULL",
    },
  },
});

module.exports = {
  PaiementClient,
};