const { EntitySchema } = require("typeorm");

const Client = new EntitySchema({
  name: "Client",
  tableName: "clients",
  columns: {
    id: { primary: true, type: "int", generated: true },
    raison_sociale: { type: "varchar", length: 100 },
    designation: { type: "varchar", length: 100, nullable: true },
    matricule_fiscal: { type: "varchar", length: 50, unique: true },
    register_commerce: { type: "varchar", length: 50, unique: true },
    adresse: { type: "varchar", length: 200 },
    ville: { type: "varchar", length: 50 },
    code_postal: { type: "varchar", length: 10 },
    telephone1: { type: "varchar", length: 20 },
    telephone2: { type: "varchar", length: 20, nullable: true },
    email: { type: "varchar", length: 100, unique: true },
    status: {
      type: "enum",
      enum: ["Actif", "Inactif"],
      default: "Actif"
    },
    createdAt: { type: "timestamp", createDate: true },
    updatedAt: { type: "timestamp", updateDate: true }
  },

});

module.exports = { Client };
