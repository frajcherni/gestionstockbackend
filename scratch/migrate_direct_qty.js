const { AppDataSource } = require("../db");

async function migrate() {
  try {
    console.log("Initializing database connection...");
    await AppDataSource.initialize();
    console.log("Database connected successfully!");

    console.log("Running migration query...");
    const result = await AppDataSource.query(`
      UPDATE bon_commande_client_articles 
      SET "quantiteLivreeDirecte" = "quantiteLivree"
    `);
    console.log("Migration completed! Result:", result);

  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    await AppDataSource.destroy();
    console.log("Database connection closed.");
  }
}

migrate();
