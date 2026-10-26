// READ-ONLY scan: finds factures whose own règlements (factures_client."paymentMethods")
// contain copies of the règlements of their source document (bon de commande,
// vente comptoire, bon de livraison). Those copies were created by the old facture
// edit modal and are counted twice in "Payé", the statut and the trésorerie.
//
// Usage (from the backend folder):  node scripts/find-copied-reglements.js
// It runs inside a READ ONLY transaction and modifies nothing.
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { Client } = require("pg");

const ALIASES = {
  especes: "especes", espece: "especes", "espèces": "especes",
  cheque: "cheque", "chèque": "cheque",
  virement: "virement", traite: "traite",
  tpe: "tpe", carte: "tpe", "carte bancaire": "tpe", "carte bancaire tpe": "tpe",
  retenue: "retenue", retention: "retenue",
};
const norm = (m) => {
  const k = String(m ?? "").trim().toLowerCase();
  return ALIASES[k] ?? k;
}; 

const amt = (v) => {
  const n = typeof v === "string" ? parseFloat(v.replace(",", ".")) : Number(v);
  return isNaN(n) ? 0 : n;
};
const asArray = (v) => {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
};
const fmt = (n) => n.toFixed(3);
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");

// Same type and amount; for chèque/traite the number must also match when both have one.
const isCopy = (own, src) => {
  const m = norm(own.method);
  if (m !== norm(src.method)) return false;
  if (m === "retenue") return true;
  if (!(amt(own.amount) > 0) || Math.abs(amt(own.amount) - amt(src.amount)) > 0.0005) return false;
  const on = String(own.numero ?? "").trim();
  const sn = String(src.numero ?? "").trim();
  if ((m === "cheque" || m === "traite") && on && sn && on !== sn) return false;
  return true;
};

(async () => {
  const db = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || "5432"),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await db.connect();
  try {
    await db.query("BEGIN READ ONLY");
    const { rows } = await db.query(`
      SELECT f.id, f."numeroFacture", f."dateFacture", f."updatedAt", f.status,
             c.raison_sociale AS client,
             f."paymentMethods" AS own,
             bc."numeroCommande" AS bc_num, bc."paymentMethods" AS bc_pm,
             vc."numeroCommande" AS vc_num, vc."paymentMethods" AS vc_pm,
             bl."numeroLivraison" AS bl_num, bl."paymentMethods" AS bl_pm
      FROM factures_client f
      LEFT JOIN clients c ON c.id = f.client_id
      LEFT JOIN bon_commande_clients bc ON bc.id = f."bonCommandeClient_id"
      LEFT JOIN vente_comptoire vc ON vc.id = f.vente_comptoire_id
      LEFT JOIN bon_livraisons bl ON bl.id = f.bon_livraison_id
      WHERE f."paymentMethods" IS NOT NULL
        AND json_typeof(f."paymentMethods"::json) = 'array'
        AND json_array_length(f."paymentMethods"::json) > 0
        AND (f."bonCommandeClient_id" IS NOT NULL OR f.vente_comptoire_id IS NOT NULL
             OR f.bon_livraison_id IS NOT NULL)
      ORDER BY f."dateFacture" DESC, f.id DESC`);

    const affected = [];
    for (const r of rows) {
      const sources = [
        r.bc_num && { label: `BC ${r.bc_num}`, pms: asArray(r.bc_pm) },
        r.vc_num && { label: `VC ${r.vc_num}`, pms: asArray(r.vc_pm) },
        r.bl_num && { label: `BL ${r.bl_num}`, pms: asArray(r.bl_pm) },
      ].filter(Boolean);
      const srcEntries = sources.flatMap((s) => s.pms.map((pm) => ({ pm, label: s.label })));
      if (srcEntries.length === 0) continue;

      const copies = [];
      const genuine = [];
      for (const o of asArray(r.own)) {
        const hit = srcEntries.find((s) => isCopy(o, s.pm));
        if (hit) copies.push({ own: o, from: hit.label });
        else genuine.push(o);
      }
      if (copies.length === 0) continue;

      affected.push({
        id: r.id,
        numero: r.numeroFacture,
        date: day(r.dateFacture),
        lastSaved: day(r.updatedAt),
        status: r.status,
        client: r.client || "",
        countedTwice: copies
          .filter((c) => norm(c.own.method) !== "retenue")
          .reduce((s, c) => s + amt(c.own.amount), 0),
        retenueCopied: copies.some((c) => norm(c.own.method) === "retenue"),
        copies: copies.map((c) => ({
          method: c.own.method, amount: amt(c.own.amount), numero: c.own.numero || "", from: c.from,
        })),
        ownKept: genuine.map((g) => ({ method: g.method, amount: amt(g.amount), numero: g.numero || "" })),
      });
    }

    const out = path.join(__dirname, "copied-reglements.json");
    fs.writeFileSync(out, JSON.stringify(affected, null, 2));

    console.log(`Factures checked (own règlements + a source document): ${rows.length}`);
    console.log(`Factures with copied règlements: ${affected.length}`);
    console.log(`Total counted twice: ${fmt(affected.reduce((s, a) => s + a.countedTwice, 0))} DT\n`);
    for (const a of affected) {
      const copied = a.copies.map((c) =>
        `${c.method} ${fmt(c.amount)}${c.numero ? ` n°${c.numero}` : ""} (from ${c.from})`);
      console.log(`#${a.id} | ${a.numero} | ${a.date} | last saved ${a.lastSaved} | ${a.status} | ${a.client}`);
      console.log(`    copied: ${copied.join("; ")}`);
      if (a.ownKept.length) {
        console.log(`    real facture règlements: ${a.ownKept.map((g) => `${g.method} ${fmt(g.amount)}`).join("; ")}`);
      }
      console.log(`    counted twice: ${fmt(a.countedTwice)} DT${a.retenueCopied ? " + retenue counted twice" : ""}`);
    }
    console.log(`\nDetails saved to ${out}`);
  } finally {
    await db.query("ROLLBACK").catch(() => {});
    await db.end();
  }
})().catch((e) => {
  console.error("Scan failed:", e.message);
  process.exit(1);
});
