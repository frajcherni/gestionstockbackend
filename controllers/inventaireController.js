// controllers/InventaireController.js
const { Inventaire, InventaireItem } = require('../entities/Inventaire');
const { Article } = require("../entities/Article");
const { Depot } = require("../entities/Depot");
const { StockDepot } = require("../entities/StockDepot");
const { AppDataSource } = require("../db");

const toInt = (v) => { const n = Math.round(parseFloat(v)); return isNaN(n) ? 0 : n; };

exports.getAllInventaires = async (req, res) => {
    try {
        const inventaires = await AppDataSource.getRepository(Inventaire).find({
            relations: ['items', 'items.article'],
            order: { created_at: 'DESC' }
        });
        res.status(200).json({ success: true, data: inventaires });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};

exports.createInventaire = async (req, res) => {
    const queryRunner = AppDataSource.createQueryRunner();
    try {
        const { numero, date, date_inventaire, depot, description, articles } = req.body;
        await queryRunner.connect();
        await queryRunner.startTransaction();

        const invRepo = queryRunner.manager.getRepository(Inventaire);
        const itemRepo = queryRunner.manager.getRepository(InventaireItem);
        const artRepo = queryRunner.manager.getRepository(Article);
        const depotRepo = queryRunner.manager.getRepository(Depot);
        const stockRepo = queryRunner.manager.getRepository(StockDepot);

        const depotEntity = await depotRepo.findOne({ where: { nom: depot } });
        if (!depotEntity) throw new Error("Dépôt introuvable");

        const inv = invRepo.create({
            numero, date, date_inventaire, depot, description: description || "",
            status: "Terminé", article_count: articles.length,
            total_ht: 0, total_tva: 0, total_ttc: 0
        });
        await invRepo.save(inv);

        let tHT = 0, tTVA = 0, tTTC = 0;
        const artTotalQte = new Map();

        for (const art of articles) {
            const article = await artRepo.findOne({ where: { id: art.article_id } });
            if (!article) continue;

            const stock = await stockRepo.findOne({ where: { article_id: art.article_id, depot_id: depotEntity.id } });
            const qte_avant = stock ? toInt(stock.qte) : 0;
            const qte_reel = toInt(art.qte_reel);

            const pua_ht = parseFloat(article.pua_ht) || 0;
            const tva_r = parseFloat(article.tva) || 19;
            const ht = pua_ht * qte_reel;
            const tva = ht * (tva_r / 100);
            const ttc = ht + tva;

            tHT += ht; tTVA += tva; tTTC += ttc;
            artTotalQte.set(art.article_id, (artTotalQte.get(art.article_id) || 0) + qte_reel);

            await itemRepo.save(itemRepo.create({
                inventaire_id: inv.id,
                article_id: art.article_id,
                ligne_numero: Number(art.ligne_numero),
                qte_avant, qte_reel, qte_ajustement: qte_reel - qte_avant,
                pua_ht, pua_ttc: pua_ht * (1 + tva_r/100), tva: tva_r,
                total_ht: ht, total_tva: tva, total_ttc: ttc
            }));
        }

        inv.total_ht = tHT; inv.total_tva = tTVA; inv.total_ttc = tTTC;
        await invRepo.save(inv);

        for (const [aid, qte] of artTotalQte) {
            let s = await stockRepo.findOne({ where: { article_id: aid, depot_id: depotEntity.id } });
            if (s) s.qte = qte;
            else s = stockRepo.create({ article_id: aid, depot_id: depotEntity.id, qte });
            await stockRepo.save(s);

            const allS = await stockRepo.find({ where: { article_id: aid } });
            await artRepo.update({ id: aid }, { qte: allS.reduce((sum, st) => sum + toInt(st.qte), 0) });
        }

        await queryRunner.commitTransaction();
        const resData = await invRepo.findOne({ where: { id: inv.id }, relations: ['items', 'items.article'] });
        res.status(201).json({ success: true, data: resData });
    } catch (e) {
        await queryRunner.rollbackTransaction();
        res.status(500).json({ success: false, message: e.message });
    } finally {
        await queryRunner.release();
    }
};

exports.updateInventaire = async (req, res) => {
    const queryRunner = AppDataSource.createQueryRunner();
    try {
        const { id } = req.params;
        const { numero, date, date_inventaire, depot, description, articles } = req.body;
        await queryRunner.connect();
        await queryRunner.startTransaction();

        const invRepo = queryRunner.manager.getRepository(Inventaire);
        const itemRepo = queryRunner.manager.getRepository(InventaireItem);
        const artRepo = queryRunner.manager.getRepository(Article);
        const stockRepo = queryRunner.manager.getRepository(StockDepot);
        const depotRepo = queryRunner.manager.getRepository(Depot);

        const inv = await invRepo.findOne({ where: { id }, relations: ['items'] });
        if (!inv) return res.status(404).json({ success: false, message: "Non trouvé" });

        const depotEntity = await depotRepo.findOne({ where: { nom: inv.depot } });
        if (!depotEntity) throw new Error("Dépôt introuvable");

        // 1. ROLLBACK Stock
        const adjMap = new Map();
        for (const it of inv.items || []) {
            adjMap.set(it.article_id, (adjMap.get(it.article_id) || 0) + toInt(it.qte_ajustement));
        }
        for (const [aid, adj] of adjMap) {
            const s = await stockRepo.findOne({ where: { article_id: aid, depot_id: depotEntity.id } });
            if (s) {
                s.qte = toInt(s.qte) - adj;
                await stockRepo.save(s);
            }
        }

        // 2. DELETE ALL Items (Guarantees zero duplicates)
        await itemRepo.delete({ inventaire_id: id });

        // 3. REBUILD from scratch
        let tHT = 0, tTVA = 0, tTTC = 0;
        const artTotalQte = new Map();
        const grouped = new Map();

        for (const a of articles) {
            const aid = Number(a.article_id);
            if (!grouped.has(aid)) grouped.set(aid, []);
            grouped.get(aid).push(a);
            artTotalQte.set(aid, (artTotalQte.get(aid) || 0) + toInt(a.qte_reel));
        }

        for (const [aid, rows] of grouped) {
            const article = await artRepo.findOne({ where: { id: aid } });
            if (!article) continue;

            const sRow = await stockRepo.findOne({ where: { article_id: aid, depot_id: depotEntity.id } });
            const qte_avant_base = sRow ? toInt(sRow.qte) : 0;
            const newTotal = toInt(artTotalQte.get(aid));

            // Update Stock Depot
            if (sRow) {
                sRow.qte = newTotal;
                await stockRepo.save(sRow);
            } else {
                await stockRepo.save(stockRepo.create({ article_id: aid, depot_id: depotEntity.id, qte: newTotal }));
            }

            // Create items
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                const pua_ht = parseFloat(article.pua_ht) || 0;
                const tva_r = parseFloat(article.tva) || 19;
                const q = toInt(r.qte_reel);
                const ht = pua_ht * q;
                const tva = ht * (tva_r / 100);
                const ttc = ht + tva;

                tHT += ht; tTVA += tva; tTTC += ttc;

                await itemRepo.save(itemRepo.create({
                    inventaire_id: id,
                    article_id: aid,
                    ligne_numero: Number(r.ligne_numero),
                    qte_avant: i === 0 ? qte_avant_base : 0,
                    qte_reel: q,
                    qte_ajustement: i === 0 ? (q - qte_avant_base) : q,
                    pua_ht, pua_ttc: pua_ht * (1 + tva_r/100), tva: tva_r,
                    total_ht: ht, total_tva: tva, total_ttc: ttc
                }));
            }
            // Update Global Art Qte
            const allS = await stockRepo.find({ where: { article_id: aid } });
            await artRepo.update({ id: aid }, { qte: allS.reduce((sum, s) => sum + toInt(s.qte), 0) });
        }

        // 4. Update Header
        await invRepo.update(id, {
            total_ht: tHT, total_tva: tTVA, total_ttc: tTTC,
            numero: numero || inv.numero,
            date, date_inventaire, description,
            article_count: articles.length,
            updated_at: new Date()
        });

        await queryRunner.commitTransaction();
        const updated = await invRepo.findOne({ where: { id }, relations: ['items', 'items.article'] });
        res.status(200).json({ success: true, data: updated });
    } catch (e) {
        await queryRunner.rollbackTransaction();
        res.status(500).json({ success: false, message: e.message });
    } finally {
        await queryRunner.release();
    }
};

exports.deleteInventaire = async (req, res) => {
    const queryRunner = AppDataSource.createQueryRunner();
    try {
        const { id } = req.params;
        await queryRunner.connect();
        await queryRunner.startTransaction();
        const invRepo = queryRunner.manager.getRepository(Inventaire);
        const itemRepo = queryRunner.manager.getRepository(InventaireItem);
        const artRepo = queryRunner.manager.getRepository(Article);
        const stockRepo = queryRunner.manager.getRepository(StockDepot);
        const depotRepo = queryRunner.manager.getRepository(Depot);

        const inv = await invRepo.findOne({ where: { id }, relations: ['items'] });
        if (!inv) return res.status(404).json({ success: false, message: "Non trouvé" });

        const depotEntity = await depotRepo.findOne({ where: { nom: inv.depot } });
        if (depotEntity) {
            const adjMap = new Map();
            for (const it of inv.items || []) adjMap.set(it.article_id, (adjMap.get(it.article_id) || 0) + toInt(it.qte_ajustement));
            for (const [aid, adj] of adjMap) {
                const s = await stockRepo.findOne({ where: { article_id: aid, depot_id: depotEntity.id } });
                if (s) {
                    s.qte = toInt(s.qte) - adj;
                    await stockRepo.save(s);
                }
                const allS = await stockRepo.find({ where: { article_id: aid } });
                await artRepo.update({ id: aid }, { qte: allS.reduce((sum, st) => sum + toInt(st.qte), 0) });
            }
        }
        await itemRepo.delete({ inventaire_id: id });
        await invRepo.delete(id);
        await queryRunner.commitTransaction();
        res.status(200).json({ success: true, message: "Supprimé" });
    } catch (e) {
        await queryRunner.rollbackTransaction();
        res.status(500).json({ success: false, message: e.message });
    } finally {
        await queryRunner.release();
    }
};

exports.getNextInventaireNumberEnhanced = async (req, res) => {
    try {
        const last = await AppDataSource.getRepository(Inventaire).find({ order: { created_at: 'DESC' }, take: 1 });
        let seq = 1;
        if (last.length > 0 && last[0].numero) {
            const m = last[0].numero.match(/INVENTAIRE-\d{4}-(\d{3})/);
            if (m) seq = parseInt(m[1]) + 1;
        }
        res.status(200).json({ success: true, data: `INVENTAIRE-${new Date().getFullYear()}-${seq.toString().padStart(3, '0')}` });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
};
