// entities/User.js
const { EntitySchema } = require("typeorm");

module.exports = new EntitySchema({
  name: "User",
  tableName: "users",
  columns: {
    id: {
      primary: true,
      type: "int",
      generated: true
    },
    username: { type: "varchar", unique: true },
    first_name: { type: "varchar", nullable: true },
    last_name: { type: "varchar", nullable: true },
    role: { type: "varchar", default: "user" },
    is_active: { type: "boolean", default: true },
    company_name: { type: "varchar", nullable: true },
    company_address: { type: "text", nullable: true },
    company_city: { type: "varchar", nullable: true },
    company_phone: { type: "varchar", nullable: true },
    company_email: { type: "varchar", nullable: true },
    company_website: { type: "varchar", nullable: true },
    company_tax_id: { type: "varchar", nullable: true },
    company_matricule_fiscal: { type: "varchar", nullable: true },
    company_logo: { type: "varchar", nullable: true },
    password: { type: "varchar" }, // hashed password
    created_at: { type: "timestamp", createDate: true },
    updated_at: { type: "timestamp", updateDate: true },
  },
});
