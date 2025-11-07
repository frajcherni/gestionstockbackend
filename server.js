const express = require("express");
const cors = require("cors");
const { AppDataSource } = require("./db");
const articleRoutes = require("./routes/articleRoutes");
const fournisseurRoutes = require("./routes/fournisseurRoutes");
const categorieRoutes = require("./routes/categorieRoutes");
const clientRoutes = require("./routes/clientRoutes");
const bonCommandeRoutes = require("./routes/bonCommandeRoutes");
const BonReceptionRoutes = require("./routes/BonReceptionRoutes");
const bonCommandeClientRoutes = require("./routes/bonCommandeClientRoutes");
const DevisRoutes = require("./routes/DevisRoutes");
const VenteComptoireRoutes = require("./routes/VenteComptoireRoutes");
const FactureFournisseurRoutes = require("./routes/FactureFournisseurRoutes");
const FactureClientRoutes = require("./routes/FactureClientRoutes");

const PaymentFournisseurRoutes = require("./routes/PaymentFournisseurRoutes");
const encaissementClientRoutes = require("./routes/encaissementClientRoutes");

const vendeurRoutes = require("./routes/vendeurRoutes");
const BonLivraisonRoutes = require("./routes/BonLivraisonRoutes");
const AuthRoutes =  require("./routes/AuthRoutes");
const TresorieRoutes =  require("./routes/TresorieRoutes");

const app = express();
app.use('/uploads', express.static('uploads'));

app.use(cors({
  origin: "*", // ou spécifie ton domaine, ex: 'http://localhost:3000'
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

app.use("/api/articles", articleRoutes);
app.use("/api/fournisseurs", fournisseurRoutes);
app.use("/api/categories", categorieRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/bons-commandes", bonCommandeRoutes);
app.use("/api/bons-Receptions", BonReceptionRoutes);
app.use("/api/bons-commande-client", bonCommandeClientRoutes); // badelha ba3ed devis route , juste professional w bara
app.use("/api/devis", DevisRoutes);

app.use("/api/bons-livraison", BonLivraisonRoutes);

app.use("/api/vendeurs", vendeurRoutes);
app.use("/api/VenteComptoire", VenteComptoireRoutes);
app.use("/api/FacturesFournisseur", FactureFournisseurRoutes);
app.use("/api/factures-client", FactureClientRoutes);
app.use("/api/PaymentFournisseur", PaymentFournisseurRoutes);
app.use("/api/EncaissementClient", encaissementClientRoutes);
app.use("/api/Auth", AuthRoutes);
app.use("/api/getpayment", TresorieRoutes);


app.get('/health', (req, res) => {
  res.json({ 
      status: 'OK', 
      message: 'Trésorerie API is running',
      timestamp: new Date().toISOString()
  });
});


AppDataSource.initialize()
  .then(() => {
    console.log("🟢 Connected to DB");
    app.listen(5000, "0.0.0.0" , () => {
      console.log("🚀 Server running on http://localhost:5000");
    });
  })
  .catch((error) => {
    console.error("🔴 Database connection error:", error);
    process.exit(1);
  });


