// controllers/TresorieController.js
const { AppDataSource } = require("../db");
const { VenteComptoire } = require("../entities/VenteComptoire");
const { EncaissementClient } = require("../entities/EncaissementClient");
const { FactureFournisseurPayment } = require("../entities/FactureFournisseurPayment");
const { FactureClient } = require("../entities/FactureClient");
const { BonCommandeClient } = require("../entities/BonCommandeClient");
const { PaiementClient } = require("../entities/PaiementClient");
const { Between, MoreThan } = require("typeorm");
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

        // Get repositories
        const venteRepo = AppDataSource.getRepository(VenteComptoire);
        const encaissementRepo = AppDataSource.getRepository(EncaissementClient);
        const paiementRepo = AppDataSource.getRepository(FactureFournisseurPayment);
        const factureRepo = AppDataSource.getRepository(FactureClient);
        const bcRepo = AppDataSource.getRepository(BonCommandeClient);
        const paiementClientRepo = AppDataSource.getRepository(PaiementClient);

        // Fetch data in parallel
        const [ventes, encaissements, paiementsFournisseurs, factures, bonCommandes, paiementsBC] = await Promise.all([
            venteRepo.find({
                where: {
                    dateCommande: Between(start, end)
                },
                relations: ['client']
            }),
            encaissementRepo.find({
                where: {
                    date: Between(start, end)
                },
                relations: ['client', 'factureClient'] // Fixed: removed bonCommandeClient
            }),
            paiementRepo.find({
                where: {
                    datePaiement: Between(start, end)
                },
                relations: ['factureFournisseur']
            }),
            factureRepo.find({
                where: {
                    dateFacture: Between(start, end)
                },
                relations: ['client']
            }),
            bcRepo.find({
                where: {
                    dateCommande: Between(start, end)
                },
                relations: ['client']
            }),
            paiementClientRepo.find({
                where: {
                    date: Between(start, end)
                },
                relations: ['client', 'bonCommandeClient']
            })
        ]);

        // Initialize payment methods by source
        const bcPayments = { especes: 0, cheque: 0, virement: 0, traite: 0, autre: 0 };
        const facturePayments = { especes: 0, cheque: 0, virement: 0, traite: 0, autre: 0 };
        const ventePayments = { especes: 0, cheque: 0, virement: 0, traite: 0, autre: 0 };
        let totalRetenue = 0;

        // Calculate totals and process payment methods
        let totalEncaissementFacture = 0;
        let totalEncaissementBC = 0;
        let totalVentesComptoire = 0;
        let totalPaiementsClients = 0;

        const transactions = [];

        // Process Facture Client direct payments
        factures.forEach(facture => {
            if (facture.paymentMethods ) {
                let facturePaymentTotal = 0;
                const paymentDetails = [];
                
                facture.paymentMethods.forEach(payment => {
                    const amount = Number(payment.amount || 0);
                    
                    if (payment.method === "retenue") {
                        // Only track retenue amount, don't add to payment methods
                        totalRetenue += amount;
                    } else {
                        facturePaymentTotal += amount;
                        const methodKey = payment.method.toLowerCase();
                        if (facturePayments[methodKey] !== undefined) {
                            facturePayments[methodKey] += amount;
                        }
                        paymentDetails.push({
                            method: payment.method,
                            amount: payment.amount,
                            numero: payment.numero || '',
                            banque: payment.banque || '',
                            dateEcheance: payment.dateEcheance || '',
                            tauxRetention: payment.tauxRetention || 0
                        });
                    }
                });

                totalEncaissementFacture += facturePaymentTotal;
                totalPaiementsClients += facturePaymentTotal;

                transactions.push({
                    id: facture.id,
                    type: 'facture_direct',
                    numero: facture.numeroFacture,
                    date: facture.dateFacture,
                    client: facture.client?.name || 'N/A',
                    montant: facturePaymentTotal,
                    paymentMethods: paymentDetails,
                    hasRetenue: facture.hasRetenue,
                    montantRetenue: facture.montantRetenue,
                    source: `Facture ${facture.numeroFacture}`
                });

                // Add separate retenue amount if exists
                if (facture.hasRetenue && facture.montantRetenue > 0) {
                    totalRetenue += Number(facture.montantRetenue || 0);
                }
            }
        });

        // Process encaissements
        encaissements.forEach(encaissement => {
            let encaissementAmount = 0;
            let paymentDetails = [];

            if (encaissement.paymentMethods) {
                // Process JSON payment methods
                encaissement.paymentMethods.forEach(payment => {
                    const paymentAmount = Number(payment.amount || 0);
                    if (payment.method === "retenue") {
                        totalRetenue += paymentAmount;
                    } else {
                        encaissementAmount += paymentAmount;
                        const methodKey = payment.method.toLowerCase();
                        if (facturePayments[methodKey] !== undefined) {
                            facturePayments[methodKey] += paymentAmount;
                        }
                        paymentDetails.push({
                            method: payment.method,
                            amount: payment.amount,
                            numero: payment.numero || '',
                            banque: payment.banque || '',
                            dateEcheance: payment.dateEcheance || '',
                            tauxRetention: payment.tauxRetention || 0
                        });
                    }
                });
            } else {
                // Legacy modePaiement field - exclude retenue from totals
                if (encaissement.modePaiement !== "Retention") {
                    encaissementAmount = Number(encaissement.montant || 0);
                    const method = encaissement.modePaiement?.toLowerCase();
                    if (method && facturePayments[method] !== undefined) {
                        facturePayments[method] += encaissementAmount;
                    }
                    paymentDetails = [{
                        method: encaissement.modePaiement,
                        amount: encaissement.montant,
                        numero: encaissement.numeroCheque || encaissement.numeroTraite || '',
                        banque: encaissement.banque || '',
                        dateEcheance: encaissement.dateEcheance || ''
                    }];
                }
            }

            // Only add to totals if there's actual payment amount (not just retenue)
            if (encaissementAmount > 0) {
                totalEncaissementFacture += encaissementAmount;
                totalPaiementsClients += encaissementAmount;

                transactions.push({
                    id: encaissement.id,
                    type: 'encaissement',
                    numero: encaissement.numeroEncaissement,
                    date: encaissement.date,
                    client: encaissement.client?.name || 'N/A',
                    montant: encaissementAmount,
                    paymentMethods: paymentDetails,
                    hasRetenue: encaissement.hasRetenue,
                    montantRetenue: encaissement.montantRetenue,
                    source: encaissement.factureClient ? `Facture ${encaissement.factureClient.numeroFacture}` : 'Direct'
                });
            }

            // Add separate retenue amount if exists
            if (encaissement.hasRetenue && encaissement.montantRetenue > 0) {
                totalRetenue += Number(encaissement.montantRetenue || 0);
            }
        });

        // Process paiements BC (PaiementClient)
        paiementsBC.forEach(paiement => {
            let paiementAmount = 0;
            let paymentDetails = [];

            if (paiement.paymentMethods) {
                paiement.paymentMethods.forEach(payment => {
                    const paymentAmount = Number(payment.amount || 0);
                    if (payment.method === "retenue") {
                        totalRetenue += paymentAmount;
                    } else {
                        paiementAmount += paymentAmount;
                        const methodKey = payment.method.toLowerCase();
                        if (bcPayments[methodKey] !== undefined) {
                            bcPayments[methodKey] += paymentAmount;
                        }
                        paymentDetails.push({
                            method: payment.method,
                            amount: payment.amount,
                            numero: payment.numero || '',
                            banque: payment.banque || '',
                            dateEcheance: payment.dateEcheance || '',
                            tauxRetention: payment.tauxRetention || 0
                        });
                    }
                });
            } else {
                // Legacy modePaiement field - exclude retenue from totals
                if (paiement.modePaiement !== "Retention") {
                    paiementAmount = Number(paiement.montant || 0);
                    const method = paiement.modePaiement?.toLowerCase();
                    if (method && bcPayments[method] !== undefined) {
                        bcPayments[method] += paiementAmount;
                    }
                    paymentDetails = [{
                        method: paiement.modePaiement,
                        amount: paiement.montant,
                        numero: paiement.numeroCheque || paiement.numeroTraite || '',
                        banque: paiement.banque || '',
                        dateEcheance: paiement.dateEcheance || ''
                    }];
                }
            }

            // Only add to totals if there's actual payment amount (not just retenue)
            if (paiementAmount > 0) {
                totalEncaissementBC += paiementAmount;
                totalPaiementsClients += paiementAmount;

                transactions.push({
                    id: paiement.id,
                    type: 'paiement_bc',
                    numero: paiement.numeroPaiement,
                    date: paiement.date,
                    client: paiement.client?.name || 'N/A',
                    montant: paiementAmount,
                    paymentMethods: paymentDetails,
                    hasRetenue: paiement.hasRetenue,
                    montantRetenue: paiement.montantRetenue,
                    source: paiement.bonCommandeClient ? `BC ${paiement.bonCommandeClient.numeroCommande}` : 'Direct'
                });
            }

            // Add separate retenue amount if exists
            if (paiement.hasRetenue && paiement.montantRetenue > 0) {
                totalRetenue += Number(paiement.montantRetenue || 0);
            }
        });

        // Process Bon Commande Client direct payment methods
        bonCommandes.forEach(bc => {
            if (bc.paymentMethods && bc.hasPayments) {
                let bcPaymentTotal = 0;
                const paymentDetails = [];
                
                bc.paymentMethods.forEach(payment => {
                    const paymentAmount = Number(payment.amount || 0);
                    
                    if (payment.method === "retenue") {
                        totalRetenue += paymentAmount;
                    } else {
                        bcPaymentTotal += paymentAmount;
                        const methodKey = payment.method.toLowerCase();
                        if (bcPayments[methodKey] !== undefined) {
                            bcPayments[methodKey] += paymentAmount;
                        }
                        paymentDetails.push({
                            method: payment.method,
                            amount: payment.amount,
                            numero: payment.numero || '',
                            banque: payment.banque || '',
                            dateEcheance: payment.dateEcheance || '',
                            tauxRetention: payment.tauxRetention || 0
                        });
                    }
                });
                
                // Only add to totals if there's actual payment amount (not just retenue)
                if (bcPaymentTotal > 0) {
                    totalEncaissementBC += bcPaymentTotal;
                    totalPaiementsClients += bcPaymentTotal;

                    transactions.push({
                        id: bc.id,
                        type: 'bon_commande',
                        numero: bc.numeroCommande,
                        date: bc.dateCommande,
                        client: bc.client?.name || 'N/A',
                        montant: bcPaymentTotal,
                        paymentMethods: paymentDetails,
                        hasRetenue: bc.hasRetenue,
                        montantRetenue: bc.montantRetenue,
                        source: `BC ${bc.numeroCommande}`
                    });
                }

                // Add separate retenue amount if exists
                if (bc.hasRetenue && bc.montantRetenue > 0) {
                    totalRetenue += Number(bc.montantRetenue || 0);
                }
            }
        });

        // Process ventes comptoire
        ventes.forEach(vente => {
            if (vente.paymentMethods) {
                let ventePaymentTotal = 0;
                const paymentDetails = [];
                
                vente.paymentMethods.forEach(payment => {
                    const amount = Number(payment.amount || 0);
                    
                    if (payment.method === "retenue") {
                        totalRetenue += amount;
                    } else {
                        ventePaymentTotal += amount;
                        const methodKey = payment.method.toLowerCase();
                        if (ventePayments[methodKey] !== undefined) {
                            ventePayments[methodKey] += amount;
                        }
                        paymentDetails.push({
                            method: payment.method,
                            amount: payment.amount,
                            numero: payment.numero || '',
                            banque: payment.banque || '',
                            dateEcheance: payment.dateEcheance || '',
                            tauxRetention: payment.tauxRetention || 0
                        });
                    }
                });

                // Only add to totals if there's actual payment amount (not just retenue)
                if (ventePaymentTotal > 0) {
                    totalVentesComptoire += ventePaymentTotal;
                    totalPaiementsClients += ventePaymentTotal;

                    transactions.push({
                        id: vente.id,
                        type: 'vente_comptoire',
                        numero: vente.numeroCommande,
                        date: vente.dateCommande,
                        client: vente.client?.name || 'Comptoire',
                        montant: ventePaymentTotal,
                        paymentMethods: paymentDetails
                    });
                }
            }
        });

        const totalPaiementsFournisseurs = paiementsFournisseurs.reduce((sum, paiement) => sum + Number(paiement.montant || 0), 0);
        const earnings = totalPaiementsClients - totalPaiementsFournisseurs;

        // Calculate overall payment methods (excluding retenue)
        const paymentMethods = {
            especes: bcPayments.especes + facturePayments.especes + ventePayments.especes,
            cheque: bcPayments.cheque + facturePayments.cheque + ventePayments.cheque,
            virement: bcPayments.virement + facturePayments.virement + ventePayments.virement,
            traite: bcPayments.traite + facturePayments.traite + ventePayments.traite,
            autre: bcPayments.autre + facturePayments.autre + ventePayments.autre,
            retenue: totalRetenue
        };

        // Sort transactions by date
        transactions.sort((a, b) => new Date(b.date) - new Date(a.date));

        res.json({
            success: true,
            data: {
                totalVentes: totalVentesComptoire,
                totalPaiementsClients,
                totalPaiementsFournisseurs,
                earnings,
                paymentMethods,
                paymentMethodsBySource: {
                    bcPayments,
                    facturePayments,
                    ventePayments
                },
                transactions,
                counts: {
                    ventes: ventes.length,
                    encaissements: encaissements.length,
                    paiementsFournisseurs: paiementsFournisseurs.length,
                    factures: factures.length,
                    bonCommandes: bonCommandes.length,
                    paiementsBC: paiementsBC.length,
                    totalTransactions: transactions.length
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

exports.getDailyStatistics = async (req, res) => {
    try {
        const { date } = req.query;
        if (!date) {
            return res.status(400).json({
                success: false,
                message: "La date est requise"
            });
        }

        const start = moment(date).startOf('day').toDate();
        const end = moment(date).endOf('day').toDate();

        const encaissementRepo = AppDataSource.getRepository(EncaissementClient);
        const paiementClientRepo = AppDataSource.getRepository(PaiementClient);
        const venteRepo = AppDataSource.getRepository(VenteComptoire);
        const bcRepo = AppDataSource.getRepository(BonCommandeClient);
        const factureRepo = AppDataSource.getRepository(FactureClient);

        const [encaissements, paiementsBC, ventes, bonCommandes, factures] = await Promise.all([
            encaissementRepo.find({
                where: { date: Between(start, end) },
                relations: ['client']
            }),
            paiementClientRepo.find({
                where: { date: Between(start, end) },
                relations: ['client']
            }),
            venteRepo.find({
                where: { dateCommande: Between(start, end) },
                relations: ['client']
            }),
            bcRepo.find({
                where: { 
                    dateCommande: Between(start, end),
                    hasPayments: true 
                },
                relations: ['client']
            }),
            factureRepo.find({
                where: { 
                    dateFacture: Between(start, end),
                    montantPaye: MoreThan(0)
                },
                relations: ['client']
            })
        ]);

        // Calculate facture direct payments
        const totalFactureDirectPayments = factures.reduce((sum, facture) => {
            if (facture.paymentMethods) {
                return sum + facture.paymentMethods.reduce((paymentSum, payment) => 
                    paymentSum + (payment.method === "retenue" ? 0 : Number(payment.amount || 0)), 0);
            }
            return sum;
        }, 0);

        const dailyStats = {
            totalEncaissements: encaissements.reduce((sum, e) => sum + Number(e.montant || 0), 0),
            totalPaiementsBC: paiementsBC.reduce((sum, p) => sum + Number(p.montant || 0), 0),
            totalVentes: ventes.reduce((sum, v) => {
                if (v.paymentMethods) {
                    return sum + v.paymentMethods.reduce((paymentSum, payment) => 
                        paymentSum + (payment.method === "retenue" ? 0 : Number(payment.amount || 0)), 0);
                }
                return sum + (Number(v.totalPaymentAmount) || Number(v.totalAfterRemise) || 0);
            }, 0),
            totalBcPayments: bonCommandes.reduce((sum, bc) => {
                if (bc.paymentMethods) {
                    return sum + bc.paymentMethods.reduce((paymentSum, payment) => 
                        paymentSum + (payment.method === "retenue" ? 0 : Number(payment.amount || 0)), 0);
                }
                return sum + (Number(bc.totalPaymentAmount) || 0);
            }, 0),
            totalFactureDirectPayments: totalFactureDirectPayments,
            countEncaissements: encaissements.length,
            countPaiementsBC: paiementsBC.length,
            countVentes: ventes.length,
            countBcWithPayments: bonCommandes.length,
            countFacturesWithPayments: factures.length
        };

        res.json({
            success: true,
            data: dailyStats
        });

    } catch (error) {
        console.error('Error in getDailyStatistics:', error);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: error.message
        });
    }
};

exports.getPaymentMethodsBreakdown = async (req, res) => {
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

        const encaissementRepo = AppDataSource.getRepository(EncaissementClient);
        const paiementClientRepo = AppDataSource.getRepository(PaiementClient);
        const venteRepo = AppDataSource.getRepository(VenteComptoire);
        const bcRepo = AppDataSource.getRepository(BonCommandeClient);
        const factureRepo = AppDataSource.getRepository(FactureClient);

        const [encaissements, paiementsBC, ventes, bonCommandes, factures] = await Promise.all([
            encaissementRepo.find({ where: { date: Between(start, end) } }),
            paiementClientRepo.find({ where: { date: Between(start, end) } }),
            venteRepo.find({ where: { dateCommande: Between(start, end) } }),
            bcRepo.find({ 
                where: { 
                    dateCommande: Between(start, end),
                    hasPayments: true 
                } 
            }),
            factureRepo.find({ 
                where: { 
                    dateFacture: Between(start, end),
                    montantPaye: MoreThan(0)
                } 
            })
        ]);

        const bcPayments = { especes: 0, cheque: 0, virement: 0, traite: 0, autre: 0 };
        const facturePayments = { especes: 0, cheque: 0, virement: 0, traite: 0, autre: 0 };
        const ventePayments = { especes: 0, cheque: 0, virement: 0, traite: 0, autre: 0 };
        let totalRetenue = 0;

        // Process all payment methods from different sources (excluding retenue)
        const processPaymentMethods = (items, targetPayments) => {
            items.forEach(item => {
                if (item.paymentMethods) {
                    item.paymentMethods.forEach(payment => {
                        const amount = Number(payment.amount || 0);
                        if (payment.method === "retenue") {
                            totalRetenue += amount;
                        } else {
                            const methodKey = payment.method.toLowerCase();
                            if (targetPayments[methodKey] !== undefined) {
                                targetPayments[methodKey] += amount;
                            }
                        }
                    });
                }
                
                // Add separate retenue amount
                if (item.hasRetenue && item.montantRetenue > 0) {
                    totalRetenue += Number(item.montantRetenue || 0);
                }
            });
        };

        processPaymentMethods(encaissements, facturePayments);
        processPaymentMethods(paiementsBC, bcPayments);
        processPaymentMethods(ventes, ventePayments);
        processPaymentMethods(bonCommandes, bcPayments);
        processPaymentMethods(factures, facturePayments);

        const breakdown = {
            bcPayments,
            facturePayments,
            ventePayments,
            totalRetenue
        };

        res.json({
            success: true,
            data: breakdown
        });

    } catch (error) {
        console.error('Error in getPaymentMethodsBreakdown:', error);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: error.message
        });
    }
};