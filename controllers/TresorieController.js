// controllers/TresorieController.js
const { AppDataSource } = require("../db");
const { VenteComptoire } = require("../entities/VenteComptoire");
const { EncaissementClient } = require("../entities/EncaissementClient");
const { FactureFournisseurPayment } = require("../entities/FactureFournisseurPayment");
const { Between } = require("typeorm");
const moment = require("moment");


// controllers/TresorieController.js - Updated version
exports.getTrésorerieData = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: "Les dates de début et de fin sont requises"
            });
        }

        const start = moment(startDate).startOf('day').toDate();
        const end = moment(endDate).endOf('day').toDate();

        // Get repositories
        const venteRepo = AppDataSource.getRepository(VenteComptoire);
        const encaissementRepo = AppDataSource.getRepository(EncaissementClient);
        const paiementRepo = AppDataSource.getRepository(FactureFournisseurPayment);

        // Fetch data in parallel
        const [ventes, encaissements, paiementsFournisseurs] = await Promise.all([
            venteRepo.find({
                where: {
                    dateCommande: Between(start, end)
                }
            }),
            encaissementRepo.find({
                where: {
                    date: Between(start, end)
                },
                relations: ['client']
            }),
            paiementRepo.find({
                where: {
                    datePaiement: Between(start, end)
                },
                relations: ['factureFournisseur']
            })
        ]);

        // Calculate totals
        const totalVentes = ventes.reduce((sum, vente) => sum + Number(vente.totalAfterRemise || 0), 0);
        const totalPaiementsClients = encaissements.reduce((sum, encaissement) => sum + Number(encaissement.montant || 0), 0);
        const totalPaiementsFournisseurs = paiementsFournisseurs.reduce((sum, paiement) => sum + Number(paiement.montant || 0), 0);
        const earnings = totalPaiementsClients - totalPaiementsFournisseurs;

        // Calculate payment methods breakdown
        const paymentMethods = {
            espece: encaissements.filter(e => e.modePaiement === 'Espece').reduce((sum, e) => sum + Number(e.montant || 0), 0),
            cheque: encaissements.filter(e => e.modePaiement === 'Cheque').reduce((sum, e) => sum + Number(e.montant || 0), 0),
            virement: encaissements.filter(e => e.modePaiement === 'Virement').reduce((sum, e) => sum + Number(e.montant || 0), 0),
            traite: encaissements.filter(e => e.modePaiement === 'Traite').reduce((sum, e) => sum + Number(e.montant || 0), 0),
            autre: encaissements.filter(e => e.modePaiement === 'Autre').reduce((sum, e) => sum + Number(e.montant || 0), 0)
        };

        // Get top products (you'll need to implement this based on your data structure)
        const topProducts = []; // Implement your top products logic here

        res.json({
            success: true,
            data: {
                totalVentes,
                totalPaiementsClients,
                totalPaiementsFournisseurs,
                earnings,
                paymentMethods,
                topProducts,
                counts: {
                    ventes: ventes.length,
                    encaissements: encaissements.length,
                    paiementsFournisseurs: paiementsFournisseurs.length
                }
            }
        });

    } catch (error) {
        console.error('Error in getTrésorerieData:', error);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: error.message
        });
    }
};

// Keep other methods simple or remove if not needed
exports.getDailyStatistics = async (req, res) => {
    res.json({ success: true, data: [] });
};

exports.getVentesDetails = async (req, res) => {
    res.json({ success: true, data: [] });
};

exports.getEncaissementsDetails = async (req, res) => {
    res.json({ success: true, data: [] });
};

exports.getPaiementsFournisseursDetails = async (req, res) => {
    res.json({ success: true, data: [] });
};