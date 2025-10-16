// controllers/TresorieController.js
const { AppDataSource } = require("../db");
const { VenteComptoire } = require("../entities/VenteComptoire");
const { EncaissementClient } = require("../entities/EncaissementClient");
const { FactureFournisseurPayment } = require("../entities/FactureFournisseurPayment");
const { Between } = require("typeorm");
const moment = require("moment");


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

        console.log(`Fetching data from ${start} to ${end}`);

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
                order: {
                    date: 'ASC'
                }
            }),
            paiementRepo.find({
                where: {
                    datePaiement: Between(start, end)
                },
                relations: ['factureFournisseur'], // Add relation to see linked data
                order: {
                    datePaiement: 'ASC'
                }
            })
        ]);

        // Add detailed logging
        console.log(`Found ${ventes.length} ventes`);
        console.log(`Found ${encaissements.length} encaissements clients`);
        console.log(`Found ${paiementsFournisseurs.length} paiements fournisseurs`);

        // Log individual payments for debugging
        paiementsFournisseurs.forEach((paiement, index) => {
            console.log(`Paiement Fournisseur ${index + 1}:`, {
                id: paiement.id,
                montant: paiement.montant,
                datePaiement: paiement.datePaiement,
                factureId: paiement.factureFournisseur?.id
            });
        });

        // Calculate totals with validation
        const totalVentes = ventes.reduce((sum, vente) => {
            const amount = Number(vente.totalAfterRemise || 0);
            return sum + (isNaN(amount) ? 0 : amount);
        }, 0);

        const totalPaiementsClients = encaissements.reduce((sum, encaissement) => {
            const amount = Number(encaissement.montant || 0);
            return sum + (isNaN(amount) ? 0 : amount);
        }, 0);

        const totalPaiementsFournisseurs = paiementsFournisseurs.reduce((sum, paiement) => {
            const amount = Number(paiement.montant || 0);
            return sum + (isNaN(amount) ? 0 : amount);
        }, 0);

        const earnings = totalPaiementsClients - totalPaiementsFournisseurs;

        console.log('Calculated totals:', {
            totalVentes,
            totalPaiementsClients,
            totalPaiementsFournisseurs,
            earnings
        });

        res.json({
            success: true,
            data: {
                totalVentes,
                totalPaiementsClients,
                totalPaiementsFournisseurs,
                earnings,
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