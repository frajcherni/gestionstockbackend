const { EntitySchema } = require("typeorm");

const Fournisseur = new EntitySchema({
  name: "Fournisseur",
  tableName: "fournisseurs",
  columns: {
    id: { primary: true, type: "int", generated: true },
    raison_sociale: { type: "varchar", length: 100, nullable: true },
    designation: { type: "varchar", length: 100, nullable: true },
    matricule_fiscal: { type: "varchar", length: 50, nullable: true },
    register_commerce: { type: "varchar", length: 50, nullable: true },
    adresse: { type: "varchar", length: 200, nullable: true },
    ville: { type: "varchar", length: 50, nullable: true },
    code_postal: { type: "varchar", length: 10, nullable: true },
    telephone1: { type: "varchar", length: 20, nullable: true },
    telephone2: { type: "varchar", length: 20, nullable: true },
    email: { type: "varchar", length: 100, nullable: true },
    status: {
      type: "enum",
      enum: ["Actif", "Inactif"],
      default: "Actif"
    },
    createdAt: { type: "timestamp", createDate: true },
    updatedAt: { type: "timestamp", updateDate: true }
  },
  relations: {
    articles: {
      type: "one-to-many",
      target: "Article", 
      inverseSide: "fournisseur"
    }
  }
});

module.exports = { Fournisseur };