// entities/ClientWebsite.js
const { EntitySchema } = require("typeorm");

const ClientWebsite = new EntitySchema({
  name: "ClientWebsite",
  tableName: "client_website",
  columns: {
    id: { 
      primary: true, 
      type: "int", 
      generated: true 
    },
    nomPrenom: { 
      type: "varchar", 
      length: 100 
    },
    telephone: { 
      type: "varchar", 
      length: 20 
    },
    email: { 
      type: "varchar", 
      length: 100, 
      nullable: true 
    },
    adresse: { 
      type: "varchar", 
      length: 200 
    },
    ville: { 
      type: "varchar", 
      length: 50, 
      nullable: true 
    },
    code_postal: { 
      type: "varchar", 
      length: 10, 
      nullable: true 
    },
    source: { 
      type: "varchar", 
      length: 20, 
      default: "website" 
    },
    createdAt: { 
      type: "timestamp", 
      default: () => "CURRENT_TIMESTAMP" 
    },
    updatedAt: { 
      type: "timestamp", 
      default: () => "CURRENT_TIMESTAMP",
      onUpdate: "CURRENT_TIMESTAMP" 
    }
  },
  relations: {
    commandes: {
      type: "one-to-many",
      target: "BonCommandeClient",
      inverseSide: "clientWebsite"
    }
  }
});

module.exports = { ClientWebsite };