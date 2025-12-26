// entities/Depot.js
const { EntitySchema } = require("typeorm");

const Depot = new EntitySchema({
  name: "Depot",
  tableName: "depots",
  columns: {
    id: { type: "int", primary: true, generated: true },
    nom: { type: "varchar", nullable: false, unique: true },
    description: { type: "varchar", nullable: true },
    created_at: { type: "timestamp", default: () => "CURRENT_TIMESTAMP" },
    updated_at: { 
      type: "timestamp", 
      default: () => "CURRENT_TIMESTAMP",
      onUpdate: "CURRENT_TIMESTAMP" 
    }
  },
  relations: {
    stocks: {
      type: "one-to-many",
      target: "StockDepot",
      inverseSide: "depot"
    }
  }
});

module.exports = { Depot };
