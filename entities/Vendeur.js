const { EntitySchema } = require("typeorm");

const Vendeur = new EntitySchema({
    name: "Vendeur",
    tableName: "vendeurs",
    columns: {
        id: { primary: true, type: "int", generated: true },
        nom: { type: "varchar", length: 100 },
        prenom: { type: "varchar", length: 100 },
        telephone: { type: "varchar", length: 20, nullable: true },
        email: { type: "varchar", length: 100, unique: true, nullable: true },
        commission: { type: "decimal", precision: 5, scale: 2, default: 0 },
        createdAt: { type: "timestamp", createDate: true },
        updatedAt: { type: "timestamp", updateDate: true }
    },
    relations: {
        commandes: {
            type: "one-to-many",
            target: "BonCommandeClient",
            inverseSide: "vendeur"
        }
    }
});

module.exports = { Vendeur };