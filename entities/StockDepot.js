// entities/StockDepot.js
const { EntitySchema } = require("typeorm");

const StockDepot = new EntitySchema({
  name: "StockDepot",
  tableName: "stock_depot",
  columns: {
    id: { type: "int", primary: true, generated: true },
    article_id: { type: "int" },
    depot_id: { type: "int" },
    qte: { type: "decimal", precision: 10, scale: 2, default: 0 }, 
        created_at: { type: "timestamp", default: () => "CURRENT_TIMESTAMP" },
    updated_at: { 
      type: "timestamp", 
      default: () => "CURRENT_TIMESTAMP",
      onUpdate: "CURRENT_TIMESTAMP" 
    }
  },
  indices: [
    {
      name: "IDX_UNIQUE_ARTICLE_DEPOT",
      columns: ["article_id", "depot_id"],
      unique: true
    }
  ],
  relations: {
    article: {
      type: "many-to-one",
      target: "Article",
      joinColumn: { name: "article_id" }
    },
    depot: {
      type: "many-to-one",
      target: "Depot",
      joinColumn: { name: "depot_id" }
    }
  }
});

module.exports = { StockDepot };
