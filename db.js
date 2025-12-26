require("dotenv").config();
const { DataSource } = require("typeorm");
const { Article } = require("./entities/Article");
const { Fournisseur } = require("./entities/Fournisseur");
const { Categorie } = require("./entities/Categorie");
const { Client } = require("./entities/Client");
const { BonCommande } = require("./entities/BonCommande");
const { BonCommandeArticle } = require("./entities/BonCommande");
const { ClientWebsite } = require("./entities/ClientWebsite");


const {
  BonReception,
  BonReceptionArticle,
} = require("./entities/BonReception");
const {
  BonCommandeClient,
  BonCommandeClientArticle,
} = require("./entities/BonCommandeClient");
const { Vendeur } = require("./entities/Vendeur");
const {
  BonLivraison,
  BonLivraisonArticle,
} = require("./entities/BonLivraison");
const { DevisClient, DevisClientArticle } = require("./entities/Devis");
const {
  VenteComptoire,
  VenteComptoireArticle,
} = require("./entities/VenteComptoire");
const {
  FactureFournisseur,
  FactureFournisseurArticle,
} = require("./entities/FactureFournisseur");
const {
  FactureFournisseurPayment,
} = require("./entities/FactureFournisseurPayment");
const {
  FactureClient,
  FactureClientArticle,
} = require("./entities/FactureClient");
const { EncaissementClient } = require("./entities/EncaissementClient");
const User = require("./entities/User");
const { PaiementClient } = require("./entities/PaiementClient");
const {Inventaire, InventaireItem} = require("./entities/Inventaire");
const {StockDepot} = require("./entities/StockDepot");
const {Depot} = require("./entities/Depot");

module.exports.AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || "5432"),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  synchronize: true,
  entities: [
    Article,
    Categorie,
    Fournisseur,
    Client,
    BonCommande,
    BonCommandeArticle,
    BonReception,
    BonReceptionArticle,
    BonCommandeClient,
    BonCommandeClientArticle,
    Vendeur,
    BonLivraison,
    BonLivraisonArticle,
    DevisClient,
    DevisClientArticle,
    VenteComptoire,
    VenteComptoireArticle,
    FactureFournisseur,
    FactureFournisseurArticle,
    FactureFournisseurPayment,
    FactureClient,
    FactureClientArticle,
    EncaissementClient,
    User,
    ClientWebsite,
    PaiementClient,
    Inventaire,
    InventaireItem,
    StockDepot,
    Depot
    
  ],
});
