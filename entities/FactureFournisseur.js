const { EntitySchema } = require("typeorm");

const FactureFournisseur = new EntitySchema({
    name: "FactureFournisseur",
    tableName: "factures_fournisseur",
    columns: {
        id: { primary: true, type: "int", generated: true },
        numeroFacture: { type: "varchar", unique: true },
        dateFacture: { type: "timestamp" },
        status: {
            type: "enum",
            enum: ["Brouillon", "Validee", "Annulee", "Payee"],
            default: "Validee"
        },
        totalHT: { type: "decimal", precision: 12, scale: 2, default: 0 },
        totalTVA: { type: "decimal", precision: 12, scale: 2, default: 0 },
        totalTTC: { type: "decimal", precision: 12, scale: 2, default: 0 },
        notes: { type: "text", nullable: true },
        modeReglement: {
            type: "enum",
            enum: ["Espece", "Cheque", "Virement", "Traite", "Autre"],
            nullable: true
        },
        dateEcheance: { type: "date", nullable: true },
        montantPaye: { type: "decimal", precision: 12, scale: 2, default: 0 },
        resteAPayer: { type: "decimal", precision: 12, scale: 2, default: 0 },
        remise: { type: "decimal", precision: 12, scale: 2, default: 0, nullable: true },
        remiseType: {
            type: "enum",
            enum: ["percentage", "fixed"],
            default: "percentage",
            nullable: true
        },
        timbreFiscal: { type: "boolean", default: false }, // Add timbreFiscal field
        conditionPaiement: { type: "varchar", nullable: true }, // Add conditionPaiement field
        createdAt: { type: "timestamp", createDate: true },
        updatedAt: { type: "timestamp", updateDate: true }
    },
    relations: {
        fournisseur: {
            type: "many-to-one",
            target: "Fournisseur",
            eager: true,
            joinColumn: { name: "fournisseur_id" },
            nullable: false
        },
        bonReception: {
            type: "many-to-one",
            target: "BonReception",
            eager: true,
            joinColumn: { name: "bon_reception_id" },
            nullable: true
        },
        articles: {
            type: "one-to-many",
            target: "FactureFournisseurArticle",
            inverseSide: "factureFournisseur",
            cascade: true,
            eager: true
        }
    }
});

const FactureFournisseurArticle = new EntitySchema({
    name: "FactureFournisseurArticle",
    tableName: "factures_fournisseur_articles",
    columns: {
        id: { primary: true, type: "int", generated: true },
        quantite: { type: "int" },
        prixUnitaire: { type: "decimal", precision: 12, scale: 2 },
        tva: { type: "decimal", precision: 5, scale: 2, nullable: true },
        remise: { type: "decimal", precision: 5, scale: 2, nullable: true, default: null }
    },
    relations: {
        factureFournisseur: {
            type: "many-to-one",
            target: "FactureFournisseur",
            joinColumn: { name: "facture_fournisseur_id" }
        },
        article: {
            type: "many-to-one",
            target: "Article",
            eager: true,
            joinColumn: { name: "article_id" }
        }
    }
});

exports.createFactureFournisseur = async (req, res) => {
    try {
        const {
            numeroFacture,
            dateFacture,
            status,
            notes,
            fournisseur_id,
            bonReception_id,
            articles,
            modeReglement,
            dateEcheance,
            montantPaye,
            resteAPayer,
            remise,
            remiseType,
            totalHT,
            totalTVA,
            totalTTC,
            timbreFiscal,
            conditionPaiement
        } = req.body;

        const fournisseurRepo = AppDataSource.getRepository(Fournisseur);
        const bonReceptionRepo = AppDataSource.getRepository(BonReception);
        const articleRepo = AppDataSource.getRepository(Article);
        const factureRepo = AppDataSource.getRepository(FactureFournisseur);

        // Validate required fields
        if (!numeroFacture || !dateFacture || !fournisseur_id) {
            return res.status(400).json({ message: 'Les champs obligatoires sont manquants' });
        }

        const fournisseur = await fournisseurRepo.findOneBy({ id: parseInt(fournisseur_id) });
        if (!fournisseur) return res.status(404).json({ message: 'Fournisseur non trouvé' });

        let bonReception = null;
        if (bonReception_id) {
            bonReception = await bonReceptionRepo.findOneBy({ id: parseInt(bonReception_id) });
            if (!bonReception) return res.status(404).json({ message: 'Bon de réception non trouvé' });
        }

        const facture = {
            numeroFacture,
            dateFacture: new Date(dateFacture),
            status,
            notes: notes || null,
            fournisseur,
            bonReception,
            conditionPaiement: conditionPaiement || null,
            modeReglement: modeReglement || null,
            dateEcheance: dateEcheance ? new Date(dateEcheance) : null,
            montantPaye: parseFloat(montantPaye || 0),
            resteAPayer: parseFloat(resteAPayer || 0),
            remise: parseFloat(remise || 0),
            remiseType: remiseType || "percentage",
            totalHT: parseFloat(totalHT || 0),
            totalTVA: parseFloat(totalTVA || 0),
            totalTTC: parseFloat(totalTTC || 0) + (timbreFiscal ? 1 : 0), // Include timbreFiscal in totalTTC
            timbreFiscal: !!timbreFiscal, // Save timbreFiscal as boolean
            articles: [],
        };

        if (!articles || !Array.isArray(articles) || articles.length === 0) {
            return res.status(400).json({ message: 'Les articles sont requis' });
        }

        for (const item of articles) {
            const articleEntity = await articleRepo.findOneBy({ id: parseInt(item.article_id) });
            if (!articleEntity) {
                return res.status(404).json({ message: `Article avec ID ${item.article_id} non trouvé` });
            }

            if (!item.quantite || !item.prix_unitaire) {
                return res.status(400).json({ message: 'Quantité et prix unitaire sont obligatoires pour chaque article' });
            }

            const factureArticle = {
                article: articleEntity,
                quantite: parseInt(item.quantite),
                prixUnitaire: parseFloat(item.prix_unitaire),
                tva: item.tva ? parseFloat(item.tva) : articleEntity.tva || 0,
                remise: item.remise ? parseFloat(item.remise) : 0
            };

            facture.articles.push(factureArticle);
        }

        const result = await factureRepo.save(facture);
        res.status(201).json(result);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Erreur serveur', error: err.message });
    }
};

module.exports = {
    FactureFournisseur,
    FactureFournisseurArticle
};