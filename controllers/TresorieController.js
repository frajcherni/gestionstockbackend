// controllers/TresorieController.js
const { AppDataSource } = require("../db");
const { VenteComptoire } = require("../entities/VenteComptoire");
const { EncaissementClient } = require("../entities/EncaissementClient");
const { FactureFournisseurPayment } = require("../entities/FactureFournisseurPayment");
const { FactureClient } = require("../entities/FactureClient");
const { BonCommandeClient } = require("../entities/BonCommandeClient");
const { BonLivraison } = require("../entities/BonLivraison");
const { PaiementClient } = require("../entities/PaiementClient");
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

        // Get repositories
        const venteRepo = AppDataSource.getRepository(VenteComptoire);
        const encaissementRepo = AppDataSource.getRepository(EncaissementClient);
        const paiementRepo = AppDataSource.getRepository(FactureFournisseurPayment);
        const factureRepo = AppDataSource.getRepository(FactureClient);
        const bcRepo = AppDataSource.getRepository(BonCommandeClient);
        const blRepo = AppDataSource.getRepository(BonLivraison);
        const paiementClientRepo = AppDataSource.getRepository(PaiementClient);

        // Fetch data with proper relations
        const [ventes, encaissements, paiementsFournisseurs, factures, bonCommandes, bonLivraisons, paiementsBC] = await Promise.all([
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
                relations: ['client', 'factureClient', 'factureClient.client']
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
            blRepo.find({
                where: {
                    dateLivraison: Between(start, end)
                },
                relations: ['client']
            }),
            paiementClientRepo.find({
                where: {
                    date: Between(start, end)
                },
                relations: ['client', 'bonCommandeClient', 'bonCommandeClient.client', 'bonLivraison', 'bonLivraison.client']
            })
        ]);

        // Initialize payment methods by source (INCLUDING retenue)
        const bcPayments = { especes: 0, cheque: 0, virement: 0, traite: 0, autre: 0, retenue: 0, carte: 0 };
        const blPayments = { especes: 0, cheque: 0, virement: 0, traite: 0, autre: 0, retenue: 0, carte: 0 };
        const facturePayments = { especes: 0, cheque: 0, virement: 0, traite: 0, autre: 0, retenue: 0, carte: 0 };
        const ventePayments = { especes: 0, cheque: 0, virement: 0, traite: 0, autre: 0, retenue: 0, carte: 0 };

        // Calculate totals and process payment methods
        let totalEncaissementFacture = 0;
        let totalEncaissementBC = 0;
        let totalEncaissementBL = 0;
        let totalVentesComptoire = 0;
        let totalPaiementsClients = 0;

        const transactions = [];

        // Helper function to extract client name
        const getClientInfo = (directClient, documentClient) => {
            if (directClient) {
                if (typeof directClient === 'string') {
                    return { client: directClient, clientObj: directClient };
                }
                return {
                    client: directClient.name || directClient.raison_sociale || directClient.designation || 'N/A',
                    clientObj: directClient
                };
            }

            if (documentClient) {
                if (typeof documentClient === 'string') {
                    return { client: documentClient, clientObj: documentClient };
                }
                return {
                    client: documentClient.name || documentClient.raison_sociale || documentClient.designation || 'N/A',
                    clientObj: documentClient
                };
            }

            return { client: 'N/A', clientObj: null };
        };

        // Helper function to check if method is retention
        const isRetention = (method) => {
            if (!method) return false;
            const methodLower = method.toLowerCase();
            return methodLower === 'retention' || methodLower === 'retenue';
        };

        // Process Facture Client direct payments
        factures.forEach(facture => {
            if (facture.paymentMethods && facture.paymentMethods.length > 0) {
                let facturePaymentTotal = 0;
                const paymentDetails = [];

                facture.paymentMethods.forEach(payment => {
                    const amount = Number(payment.amount || 0);
                    const method = payment.method || '';

                    facturePaymentTotal += amount;

                    if (isRetention(method)) {
                        facturePayments.retenue += amount;
                    } else {
                        const methodKey = method.toLowerCase();
                        if (facturePayments[methodKey] !== undefined) {
                            facturePayments[methodKey] += amount;
                        }
                    }

                    paymentDetails.push({
                        method: payment.method,
                        amount: payment.amount,
                        numero: payment.numero || '',
                        banque: payment.banque || '',
                        dateEcheance: payment.dateEcheance || '',
                        tauxRetention: payment.tauxRetention || 0
                    });
                });

                // Add regular payments to transactions
                if (facturePaymentTotal > 0) {
                    totalEncaissementFacture += facturePaymentTotal;
                    totalPaiementsClients += facturePaymentTotal;

                    const clientInfo = getClientInfo(facture.client, null);

                    transactions.push({
                        id: facture.id,
                        type: 'facture_direct',
                        numero: facture.numeroFacture,
                        numeroFacture: facture.numeroFacture,
                        date: facture.dateFacture,
                        client: clientInfo.client,
                        clientObj: clientInfo.clientObj,
                        montant: facturePaymentTotal,
                        paymentMethods: paymentDetails,
                        hasRetenue: facture.hasRetenue,
                        montantRetenue: facture.montantRetenue || 0,
                        source: `Facture ${facture.numeroFacture}`,
                        factureClient: facture
                    });
                }
            }

            // Handle retenue from montantRetenue field
            if (facture.hasRetenue && facture.montantRetenue > 0) {
                const retenueAmount = Number(facture.montantRetenue || 0);
                facturePayments.retenue += retenueAmount;

                const clientInfo = getClientInfo(facture.client, null);

                transactions.push({
                    id: `facture_${facture.id}_retenue`,
                    type: 'facture_direct',
                    numero: facture.numeroFacture,
                    numeroFacture: facture.numeroFacture,
                    date: facture.dateFacture,
                    client: clientInfo.client,
                    clientObj: clientInfo.clientObj,
                    montant: retenueAmount,
                    paymentMethods: [{
                        method: "Retenue",
                        amount: retenueAmount,
                        tauxRetention: 0
                    }],
                    hasRetenue: true,
                    montantRetenue: retenueAmount,
                    source: `Facture ${facture.numeroFacture}`,
                    factureClient: facture
                });
            }
        });

        // Process encaissements
        encaissements.forEach(encaissement => {
            let encaissementAmount = 0;
            const paymentDetails = [];

            if (encaissement.paymentMethods && encaissement.paymentMethods.length > 0) {
                encaissement.paymentMethods.forEach(payment => {
                    const amount = Number(payment.amount || 0);
                    const method = payment.method || '';

                    encaissementAmount += amount;

                    if (isRetention(method)) {
                        facturePayments.retenue += amount;
                    } else {
                        const methodKey = method.toLowerCase();
                        if (facturePayments[methodKey] !== undefined) {
                            facturePayments[methodKey] += amount;
                        }
                    }

                    paymentDetails.push({
                        method: payment.method,
                        amount: payment.amount,
                        numero: payment.numero || '',
                        banque: payment.banque || '',
                        dateEcheance: payment.dateEcheance || '',
                        tauxRetention: payment.tauxRetention || 0
                    });
                });
            } else {
                // Legacy modePaiement field
                if (encaissement.modePaiement) {
                    const amount = Number(encaissement.montant || 0);
                    const method = encaissement.modePaiement;

                    encaissementAmount += amount;

                    if (isRetention(method)) {
                        facturePayments.retenue += amount;
                    } else {
                        const methodKey = method.toLowerCase();
                        if (facturePayments[methodKey] !== undefined) {
                            facturePayments[methodKey] += amount;
                        }
                    }

                    paymentDetails.push({
                        method: encaissement.modePaiement,
                        amount: encaissement.montant,
                        numero: encaissement.numeroCheque || encaissement.numeroTraite || '',
                        banque: encaissement.banque || '',
                        dateEcheance: encaissement.dateEcheance || ''
                    });
                }
            }

            // Add regular payments to transactions
            if (encaissementAmount > 0) {
                totalEncaissementFacture += encaissementAmount;
                totalPaiementsClients += encaissementAmount;

                const documentClient = encaissement.factureClient?.client || null;
                const clientInfo = getClientInfo(encaissement.client, documentClient);

                transactions.push({
                    id: encaissement.id,
                    type: 'encaissement',
                    numero: encaissement.numeroEncaissement,
                    numeroEncaissement: encaissement.numeroEncaissement,
                    date: encaissement.date,
                    client: clientInfo.client,
                    clientObj: clientInfo.clientObj,
                    montant: encaissementAmount,
                    paymentMethods: paymentDetails,
                    hasRetenue: encaissement.hasRetenue,
                    montantRetenue: encaissement.montantRetenue || 0,
                    source: encaissement.factureClient ? `Facture ${encaissement.factureClient.numeroFacture}` : 'Direct',
                    factureClient: encaissement.factureClient
                });
            }

            // Handle retenue from montantRetenue field
            if (encaissement.hasRetenue && encaissement.montantRetenue > 0) {
                const retenueAmount = Number(encaissement.montantRetenue || 0);
                facturePayments.retenue += retenueAmount;

                const documentClient = encaissement.factureClient?.client || null;
                const clientInfo = getClientInfo(encaissement.client, documentClient);

                transactions.push({
                    id: `encaissement_${encaissement.id}_retenue`,
                    type: 'encaissement',
                    numero: encaissement.numeroEncaissement,
                    numeroEncaissement: encaissement.numeroEncaissement,
                    date: encaissement.date,
                    client: clientInfo.client,
                    clientObj: clientInfo.clientObj,
                    montant: retenueAmount,
                    paymentMethods: [{
                        method: "Retenue",
                        amount: retenueAmount,
                        tauxRetention: encaissement.tauxRetention || 0
                    }],
                    hasRetenue: true,
                    montantRetenue: retenueAmount,
                    source: encaissement.factureClient ? `Facture ${encaissement.factureClient.numeroFacture}` : 'Direct',
                    factureClient: encaissement.factureClient
                });
            }
        });

        // Process Bon Commande Client direct payment methods
        // Process Bon Commande Client direct payment methods
        bonCommandes.forEach(bc => {
            let bcPaymentTotal = 0;
            const paymentDetails = [];

            // Process payment methods if they exist
            if (bc.paymentMethods && bc.paymentMethods.length > 0) {
                bc.paymentMethods.forEach(payment => {
                    const amount = Number(payment.amount || 0);
                    const method = payment.method || '';

                    bcPaymentTotal += amount;

                    if (isRetention(method)) {
                        bcPayments.retenue += amount;
                    } else {
                        const methodKey = method.toLowerCase();
                        if (bcPayments[methodKey] !== undefined) {
                            bcPayments[methodKey] += amount;
                        }
                    }

                    paymentDetails.push({
                        method: payment.method,
                        amount: payment.amount,
                        numero: payment.numero || '',
                        banque: payment.banque || '',
                        dateEcheance: payment.dateEcheance || '',
                        tauxRetention: payment.tauxRetention || 0
                    });
                });
            }

            // Handle retenue from montantRetenue field - ADD TO THE SAME TRANSACTION
            if (bc.hasRetenue && bc.montantRetenue > 0) {
                const retenueAmount = Number(bc.montantRetenue || 0);
                bcPayments.retenue += retenueAmount;

                // Check if retention payment already exists
                const existingRetention = paymentDetails.find(p =>
                    p.method.toLowerCase() === 'retenue' || p.method.toLowerCase() === 'retention'
                );

                if (existingRetention) {
                    // Update existing retention amount
                    existingRetention.amount = retenueAmount;
                    bcPaymentTotal = bcPaymentTotal - Number(existingRetention.amount || 0) + retenueAmount;
                } else {
                    // Add new retention payment
                    paymentDetails.push({
                        method: "Retenue",
                        amount: retenueAmount,
                        tauxRetention: 1
                    });
                    bcPaymentTotal += retenueAmount;
                }
            }

            // Add SINGLE transaction with ALL payment methods
            if (bcPaymentTotal > 0 || paymentDetails.length > 0) {
                totalEncaissementBC += bcPaymentTotal;
                totalPaiementsClients += bcPaymentTotal;

                const clientInfo = getClientInfo(bc.client, null);

                transactions.push({
                    id: bc.id,
                    type: 'bon_commande',
                    numero: bc.numeroCommande,
                    date: bc.dateCommande,
                    client: clientInfo.client,
                    montant: bcPaymentTotal,
                    paymentMethods: paymentDetails,
                    source: `BC ${bc.numeroCommande}`
                });
            }

            // REMOVE the separate retention transaction that was here!
        });

        // Process Bon Livraison Client direct payment methods
        bonLivraisons.forEach(bl => {
            let blPaymentTotal = 0;
            const paymentDetails = [];

            if (bl.paymentMethods && bl.paymentMethods.length > 0) {
                bl.paymentMethods.forEach(payment => {
                    const amount = Number(payment.amount || 0);
                    const method = payment.method || '';

                    blPaymentTotal += amount;

                    if (isRetention(method)) {
                        blPayments.retenue += amount;
                    } else {
                        const methodKey = method.toLowerCase();
                        if (blPayments[methodKey] !== undefined) {
                            blPayments[methodKey] += amount;
                        }
                    }

                    paymentDetails.push({
                        method: payment.method,
                        amount: payment.amount,
                        numero: payment.numero || '',
                        banque: payment.banque || '',
                        dateEcheance: payment.dateEcheance || '',
                        tauxRetention: payment.tauxRetention || 0
                    });
                });
            }

            if (bl.hasRetenue && bl.montantRetenue > 0) {
                const retenueAmount = Number(bl.montantRetenue || 0);
                blPayments.retenue += retenueAmount;

                const existingRetention = paymentDetails.find(p =>
                    p.method.toLowerCase() === 'retenue' || p.method.toLowerCase() === 'retention'
                );

                if (existingRetention) {
                    existingRetention.amount = retenueAmount;
                    blPaymentTotal = blPaymentTotal - Number(existingRetention.amount || 0) + retenueAmount;
                } else {
                    paymentDetails.push({
                        method: "Retenue",
                        amount: retenueAmount,
                        tauxRetention: 1
                    });
                    blPaymentTotal += retenueAmount;
                }
            }

            if (blPaymentTotal > 0 || paymentDetails.length > 0) {
                totalEncaissementBL += blPaymentTotal;
                totalPaiementsClients += blPaymentTotal;

                const clientInfo = getClientInfo(bl.client, null);

                transactions.push({
                    id: bl.id,
                    type: 'bon_livraison',
                    numero: bl.numeroLivraison,
                    date: bl.dateLivraison,
                    client: clientInfo.client,
                    montant: blPaymentTotal,
                    paymentMethods: paymentDetails,
                    source: `BL ${bl.numeroLivraison}`
                });
            }
        });

        // Process paiements BC & BL (PaiementClient)
        paiementsBC.forEach(paiement => {
            let paiementAmount = 0;
            const paymentDetails = [];

            if (paiement.paymentMethods && paiement.paymentMethods.length > 0) {
                paiement.paymentMethods.forEach(payment => {
                    const amount = Number(payment.amount || 0);
                    const method = payment.method || '';

                    paiementAmount += amount;

                    if (isRetention(method)) {
                        if (paiement.bonLivraison_id) blPayments.retenue += amount;
                        else bcPayments.retenue += amount;
                    } else {
                        const methodKey = method.toLowerCase();
                        if (paiement.bonLivraison_id && blPayments[methodKey] !== undefined) {
                            blPayments[methodKey] += amount;
                        } else if (bcPayments[methodKey] !== undefined) {
                            bcPayments[methodKey] += amount;
                        }
                    }

                    paymentDetails.push({
                        method: payment.method,
                        amount: payment.amount,
                        numero: payment.numero || '',
                        banque: payment.banque || '',
                        dateEcheance: payment.dateEcheance || '',
                        tauxRetention: payment.tauxRetention || 0
                    });
                });
            } else {
                // Legacy modePaiement field
                if (paiement.modePaiement) {
                    const amount = Number(paiement.montant || 0);
                    const method = paiement.modePaiement;

                    paiementAmount += amount;

                    if (isRetention(method)) {
                        if (paiement.bonCommandeClient_id) bcPayments.retenue += amount;
                        if (paiement.bonLivraison_id) blPayments.retenue += amount;
                        if (!paiement.bonCommandeClient_id && !paiement.bonLivraison_id) bcPayments.retenue += amount;
                    } else {
                        const methodKey = method.toLowerCase();
                        if (paiement.bonCommandeClient_id && bcPayments[methodKey] !== undefined) {
                            bcPayments[methodKey] += amount;
                        } else if (paiement.bonLivraison_id && blPayments[methodKey] !== undefined) {
                            blPayments[methodKey] += amount;
                        } else {
                            if (bcPayments[methodKey] !== undefined) bcPayments[methodKey] += amount;
                        }
                    }

                    paymentDetails.push({
                        method: paiement.modePaiement,
                        amount: paiement.montant,
                        numero: paiement.numeroCheque || paiement.numeroTraite || '',
                        banque: paiement.banque || '',
                        dateEcheance: paiement.dateEcheance || ''
                    });
                }
            }

            // Add regular payments to transactions
            if (paiementAmount > 0) {
                if (paiement.bonCommandeClient_id) totalEncaissementBC += paiementAmount;
                else if (paiement.bonLivraison_id) totalEncaissementBL += paiementAmount;
                else totalEncaissementBC += paiementAmount; // Default

                totalPaiementsClients += paiementAmount;

                const documentClient = (paiement.bonCommandeClient?.client || paiement.bonLivraison?.client) || null;
                const clientInfo = getClientInfo(paiement.client, documentClient);

                transactions.push({
                    id: paiement.id,
                    type: paiement.bonLivraison_id ? 'paiement_bl' : 'paiement_bc',
                    numero: paiement.numeroPaiement,
                    numeroPaiement: paiement.numeroPaiement,
                    date: paiement.date,
                    client: clientInfo.client,
                    clientObj: clientInfo.clientObj,
                    montant: paiementAmount,
                    paymentMethods: paymentDetails,
                    hasRetenue: paiement.hasRetenue,
                    montantRetenue: paiement.montantRetenue || 0,
                    source: paiement.bonCommandeClient ? `BC ${paiement.bonCommandeClient.numeroCommande}` : (paiement.bonLivraison ? `BL ${paiement.bonLivraison.numeroLivraison}` : 'Direct'),
                    bonCommandeClient: paiement.bonCommandeClient,
                    bonLivraison: paiement.bonLivraison
                });
            }

            // Handle retenue from montantRetenue field
            if (paiement.hasRetenue && paiement.montantRetenue > 0) {
                const retenueAmount = Number(paiement.montantRetenue || 0);
                if (paiement.bonCommandeClient_id) bcPayments.retenue += retenueAmount;
                else if (paiement.bonLivraison_id) blPayments.retenue += retenueAmount;
                else bcPayments.retenue += retenueAmount;

                const documentClient = (paiement.bonCommandeClient?.client || paiement.bonLivraison?.client) || null;
                const clientInfo = getClientInfo(paiement.client, documentClient);

                transactions.push({
                    id: `paiement_${paiement.id}_retenue`,
                    type: paiement.bonLivraison_id ? 'paiement_bl' : 'paiement_bc',
                    numero: paiement.numeroPaiement,
                    numeroPaiement: paiement.numeroPaiement,
                    date: paiement.date,
                    client: clientInfo.client,
                    clientObj: clientInfo.clientObj,
                    montant: retenueAmount,
                    paymentMethods: [{
                        method: "Retenue",
                        amount: retenueAmount,
                        tauxRetention: paiement.tauxRetention || 0
                    }],
                    hasRetenue: true,
                    montantRetenue: retenueAmount,
                    source: paiement.bonCommandeClient ? `BC ${paiement.bonCommandeClient.numeroCommande}` : (paiement.bonLivraison ? `BL ${paiement.bonLivraison.numeroLivraison}` : 'Direct'),
                    bonCommandeClient: paiement.bonCommandeClient,
                    bonLivraison: paiement.bonLivraison
                });
            }
        });

        // Process ventes comptoire
        ventes.forEach(vente => {
            if (vente.paymentMethods && vente.paymentMethods.length > 0) {
                let ventePaymentTotal = 0;
                const paymentDetails = [];

                vente.paymentMethods.forEach(payment => {
                    const amount = Number(payment.amount || 0);
                    const method = payment.method || '';

                    ventePaymentTotal += amount;

                    if (isRetention(method)) {
                        ventePayments.retenue += amount;
                    } else {
                        const methodKey = method.toLowerCase();
                        if (ventePayments[methodKey] !== undefined) {
                            ventePayments[methodKey] += amount;
                        }
                    }

                    paymentDetails.push({
                        method: payment.method,
                        amount: payment.amount,
                        numero: payment.numero || '',
                        banque: payment.banque || '',
                        dateEcheance: payment.dateEcheance || '',
                        tauxRetention: payment.tauxRetention || 0
                    });
                });

                // Add regular payments to transactions
                if (ventePaymentTotal > 0) {
                    totalVentesComptoire += ventePaymentTotal;
                    totalPaiementsClients += ventePaymentTotal;

                    const clientInfo = getClientInfo(vente.client, null);

                    transactions.push({
                        id: vente.id,
                        type: 'vente_comptoire',
                        numero: vente.numeroCommande,
                        numeroCommande: vente.numeroCommande,
                        date: vente.dateCommande,
                        client: clientInfo.client || 'Comptoir',
                        clientObj: clientInfo.clientObj,
                        montant: ventePaymentTotal,
                        paymentMethods: paymentDetails
                    });
                }
            }
        });

        const totalPaiementsFournisseurs = paiementsFournisseurs.reduce((sum, paiement) => sum + Number(paiement.montant || 0), 0);

        // Calculate overall payment methods
        const paymentMethods = {
            especes: bcPayments.especes + blPayments.especes + facturePayments.especes + ventePayments.especes,
            cheque: bcPayments.cheque + blPayments.cheque + facturePayments.cheque + ventePayments.cheque,
            virement: bcPayments.virement + blPayments.virement + facturePayments.virement + ventePayments.virement,
            traite: bcPayments.traite + blPayments.traite + facturePayments.traite + ventePayments.traite,
            autre: bcPayments.autre + blPayments.autre + facturePayments.autre + ventePayments.autre,
            retenue: bcPayments.retenue + blPayments.retenue + facturePayments.retenue + ventePayments.retenue,
            carte: bcPayments.carte + blPayments.carte + facturePayments.carte + ventePayments.carte
        };

        // Sort all transactions by date
        transactions.sort((a, b) => new Date(a.date) - new Date(b.date));

        res.json({
            success: true,
            data: {
                totalVentes: totalVentesComptoire,
                totalPaiementsClients,
                totalPaiementsFournisseurs,
                earnings: totalPaiementsClients - totalPaiementsFournisseurs,
                paymentMethods,
                paymentMethodsBySource: {
                    bcPayments,
                    blPayments,
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
                    bonLivraisons: bonLivraisons.length,
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


// dashboardController.js
const {  BonCommandeClientArticle } = require("../entities/BonCommandeClient");
const { DevisClient, DevisClientArticle } = require("../entities/Devis");


/**
 * Get dashboard statistics between two dates
 * @param {Date} startDate - Start date for filtering
 * @param {Date} endDate - End date for filtering
 * @returns {Object} Aggregated dashboard data
 */
exports.getDashboardDataByDateRange = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        // Validate date inputs
        if (!startDate || !endDate) {
            return res.status(400).json({
                message: "Les dates de début et de fin sont requises"
            });
        }

        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999); // Include the entire end day

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({
                message: "Format de date invalide"
            });
        }

        // Execute all queries in parallel for better performance
        const [
            commandesData,
            livraisonsData,
            facturesData,
            devisData,
            ventesComptoireData,
            topProductsData,
            topClientsData,
            monthlyTrendsData
        ] = await Promise.all([
            getCommandesStats(start, end),
            getLivraisonsStats(start, end),
            getFacturesStats(start, end),
            getDevisStats(start, end),
            getVentesComptoireStats(start, end),
            getTopProducts(start, end),
            getTopClients(start, end),
            getMonthlyTrends(start, end)
        ]);

        // Calculate summary statistics
        const summary = {
            totalCommandes: commandesData.total,
            totalLivraisons: livraisonsData.total,
            totalFactures: facturesData.total,
            totalDevis: devisData.total,
            totalVentesComptoire: ventesComptoireData.total,
            chiffreAffaires: facturesData.totalTTC + ventesComptoireData.totalTTC,
            totalTTC: facturesData.totalTTC + ventesComptoireData.totalTTC,
            totalHT: facturesData.totalHT + ventesComptoireData.totalHT,
            totalTVA: facturesData.totalTVA + ventesComptoireData.totalTVA,
            totalRemises: facturesData.totalRemises + ventesComptoireData.totalRemises,
            totalPaymentsReceived: facturesData.totalPayments + ventesComptoireData.totalPayments,
            totalPendingPayments: (facturesData.totalTTC + ventesComptoireData.totalTTC) -
                (facturesData.totalPayments + ventesComptoireData.totalPayments),
            totalArticlesVendus: commandesData.totalArticles + ventesComptoireData.totalArticles
        };

        res.json({
            success: true,
            period: {
                startDate: start,
                endDate: end
            },
            summary,
            details: {
                commandes: commandesData,
                livraisons: livraisonsData,
                factures: facturesData,
                devis: devisData,
                ventesComptoire: ventesComptoireData,
                topProducts: topProductsData,
                topClients: topClientsData,
                monthlyTrends: monthlyTrendsData
            }
        });

    } catch (error) {
        console.error("Dashboard error:", error);
        res.status(500).json({
            message: "Erreur lors de la récupération des données du tableau de bord",
            error: error.message
        });
    }
};

/**
 * Get commandes client statistics between dates
 */
async function getCommandesStats(startDate, endDate) {
    const repo = AppDataSource.getRepository(BonCommandeClient);

    const [commandes, total, totalTTC, totalHT, totalTVA, totalArticles] = await Promise.all([
        repo.find({
            where: {
                dateCommande: Between(startDate, endDate)
            },
            relations: ["client", "vendeur", "articles", "articles.article"],
            order: { dateCommande: "DESC" }
        }),
        repo.count({
            where: { dateCommande: Between(startDate, endDate) }
        }),
        repo.createQueryBuilder("bc")
            .select("SUM(bc.totalTTCAfterRemise)", "total")
            .where("bc.dateCommande BETWEEN :start AND :end", { start: startDate, end: endDate })
            .getRawOne(),
        repo.createQueryBuilder("bc")
            .select("SUM(bc.totalHT)", "total")
            .where("bc.dateCommande BETWEEN :start AND :end", { start: startDate, end: endDate })
            .getRawOne(),
        repo.createQueryBuilder("bc")
            .select("SUM(bc.totalTVA)", "total")
            .where("bc.dateCommande BETWEEN :start AND :end", { start: startDate, end: endDate })
            .getRawOne(),
        repo.createQueryBuilder("bc")
            .leftJoin("bc.articles", "articles")
            .select("SUM(articles.quantite)", "total")
            .where("bc.dateCommande BETWEEN :start AND :end", { start: startDate, end: endDate })
            .getRawOne()
    ]);

    // Group by status
    const byStatus = await repo.createQueryBuilder("bc")
        .select("bc.status", "status")
        .addSelect("COUNT(*)", "count")
        .addSelect("SUM(bc.totalTTCAfterRemise)", "totalTTC")
        .where("bc.dateCommande BETWEEN :start AND :end", { start: startDate, end: endDate })
        .groupBy("bc.status")
        .getRawMany();

    return {
        commandes,
        total: total || 0,
        totalTTC: parseFloat(totalTTC?.total) || 0,
        totalHT: parseFloat(totalHT?.total) || 0,
        totalTVA: parseFloat(totalTVA?.total) || 0,
        totalArticles: parseInt(totalArticles?.total) || 0,
        byStatus
    };
}

/**
 * Get livraisons statistics between dates
 */
async function getLivraisonsStats(startDate, endDate) {
    const repo = AppDataSource.getRepository(BonLivraison);

    const [livraisons, total, totalTTC, totalArticles] = await Promise.all([
        repo.find({
            where: {
                dateLivraison: Between(startDate, endDate)
            },
            relations: ["client", "vendeur", "bonCommandeClient", "articles", "articles.article"],
            order: { dateLivraison: "DESC" }
        }),
        repo.count({
            where: { dateLivraison: Between(startDate, endDate) }
        }),
        repo.createQueryBuilder("bl")
            .select("SUM(bl.totalTTCAfterRemise)", "total")
            .where("bl.dateLivraison BETWEEN :start AND :end", { start: startDate, end: endDate })
            .getRawOne(),
        repo.createQueryBuilder("bl")
            .leftJoin("bl.articles", "articles")
            .select("SUM(articles.quantite)", "total")
            .where("bl.dateLivraison BETWEEN :start AND :end", { start: startDate, end: endDate })
            .getRawOne()
    ]);

    return {
        livraisons,
        total: total || 0,
        totalTTC: parseFloat(totalTTC?.total) || 0,
        totalArticles: parseInt(totalArticles?.total) || 0
    };
}

/**
 * Get factures statistics between dates
 */
async function getFacturesStats(startDate, endDate) {
    const repo = AppDataSource.getRepository(FactureClient);

    const [factures, total, totalTTC, totalHT, totalTVA, totalPayments, totalRemises] = await Promise.all([
        repo.find({
            where: {
                dateFacture: Between(startDate, endDate)
            },
            relations: ["client", "vendeur", "bonLivraison", "bonCommandeClient", "articles", "articles.article"],
            order: { dateFacture: "DESC" }
        }),
        repo.count({
            where: { dateFacture: Between(startDate, endDate) }
        }),
        repo.createQueryBuilder("f")
            .select("SUM(f.totalTTCAfterRemise)", "total")
            .where("f.dateFacture BETWEEN :start AND :end", { start: startDate, end: endDate })
            .getRawOne(),
        repo.createQueryBuilder("f")
            .select("SUM(f.totalHT)", "total")
            .where("f.dateFacture BETWEEN :start AND :end", { start: startDate, end: endDate })
            .getRawOne(),
        repo.createQueryBuilder("f")
            .select("SUM(f.totalTVA)", "total")
            .where("f.dateFacture BETWEEN :start AND :end", { start: startDate, end: endDate })
            .getRawOne(),
        repo.createQueryBuilder("f")
            .select("SUM(f.montantPaye)", "total")
            .where("f.dateFacture BETWEEN :start AND :end", { start: startDate, end: endDate })
            .getRawOne(),
        repo.createQueryBuilder("f")
            .select("SUM(f.remise)", "total")
            .where("f.dateFacture BETWEEN :start AND :end", { start: startDate, end: endDate })
            .getRawOne()
    ]);

    // Group by status
    const byStatus = await repo.createQueryBuilder("f")
        .select("f.status", "status")
        .addSelect("COUNT(*)", "count")
        .addSelect("SUM(f.totalTTCAfterRemise)", "totalTTC")
        .where("f.dateFacture BETWEEN :start AND :end", { start: startDate, end: endDate })
        .groupBy("f.status")
        .getRawMany();

    return {
        factures,
        total: total || 0,
        totalTTC: parseFloat(totalTTC?.total) || 0,
        totalHT: parseFloat(totalHT?.total) || 0,
        totalTVA: parseFloat(totalTVA?.total) || 0,
        totalPayments: parseFloat(totalPayments?.total) || 0,
        totalRemises: parseFloat(totalRemises?.total) || 0,
        byStatus
    };
}

/**
 * Get devis statistics between dates
 */
async function getDevisStats(startDate, endDate) {
    const repo = AppDataSource.getRepository(DevisClient);

    const [devis, total, totalTTC, conversionRate] = await Promise.all([
        repo.find({
            where: {
                dateCommande: Between(startDate, endDate)
            },
            relations: ["client", "vendeur", "articles", "articles.article"],
            order: { dateCommande: "DESC" }
        }),
        repo.count({
            where: { dateCommande: Between(startDate, endDate) }
        }),
        repo.createQueryBuilder("d")
            .select("SUM(d.totalTTCAfterRemise)", "total")
            .where("d.dateCommande BETWEEN :start AND :end", { start: startDate, end: endDate })
            .getRawOne(),
        // Calculate conversion rate (devis converted to commandes)
        AppDataSource.createQueryBuilder()
            .select("COUNT(DISTINCT d.id)", "totalDevis")
            .addSelect("COUNT(DISTINCT bc.id)", "totalCommandes")
            .from(DevisClient, "d")
            .leftJoin(BonCommandeClient, "bc", "bc.numeroCommande = d.numeroCommande")
            .where("d.dateCommande BETWEEN :start AND :end", { start: startDate, end: endDate })
            .getRawOne()
    ]);

    const convertedCount = conversionRate?.totalCommandes || 0;
    const devisCount = conversionRate?.totalDevis || 0;
    const rate = devisCount > 0 ? (convertedCount / devisCount) * 100 : 0;

    // Group by status
    const byStatus = await repo.createQueryBuilder("d")
        .select("d.status", "status")
        .addSelect("COUNT(*)", "count")
        .addSelect("SUM(d.totalTTCAfterRemise)", "totalTTC")
        .where("d.dateCommande BETWEEN :start AND :end", { start: startDate, end: endDate })
        .groupBy("d.status")
        .getRawMany();

    return {
        devis,
        total: total || 0,
        totalTTC: parseFloat(totalTTC?.total) || 0,
        conversionRate: {
            totalDevis: devisCount,
            totalConverted: convertedCount,
            rate: parseFloat(rate.toFixed(2))
        },
        byStatus
    };
}

/**
 * Get ventes comptoire statistics between dates
 */
async function getVentesComptoireStats(startDate, endDate) {
    const repo = AppDataSource.getRepository(VenteComptoire);

    const [ventes, total, totalTTC, totalHT, totalTVA, totalPayments, totalArticles] = await Promise.all([
        repo.find({
            where: {
                dateCommande: Between(startDate, endDate)
            },
            relations: ["client", "vendeur", "articles", "articles.article"],
            order: { dateCommande: "DESC" }
        }),
        repo.count({
            where: { dateCommande: Between(startDate, endDate) }
        }),
        repo.createQueryBuilder("vc")
            .select("SUM(vc.totalAfterRemise)", "total")
            .where("vc.dateCommande BETWEEN :start AND :end", { start: startDate, end: endDate })
            .getRawOne(),
        repo.createQueryBuilder("vc")
            .select("SUM(vc.subTotal)", "total")
            .where("vc.dateCommande BETWEEN :start AND :end", { start: startDate, end: endDate })
            .getRawOne(),
        repo.createQueryBuilder("vc")
            .select("SUM(vc.totalTax)", "total")
            .where("vc.dateCommande BETWEEN :start AND :end", { start: startDate, end: endDate })
            .getRawOne(),
        repo.createQueryBuilder("vc")
            .select("SUM(vc.totalPaymentAmount)", "total")
            .where("vc.dateCommande BETWEEN :start AND :end", { start: startDate, end: endDate })
            .getRawOne(),
        repo.createQueryBuilder("vc")
            .leftJoin("vc.articles", "articles")
            .select("SUM(articles.quantite)", "total")
            .where("vc.dateCommande BETWEEN :start AND :end", { start: startDate, end: endDate })
            .getRawOne()
    ]);

    return {
        ventes,
        total: total || 0,
        totalTTC: parseFloat(totalTTC?.total) || 0,
        totalHT: parseFloat(totalHT?.total) || 0,
        totalTVA: parseFloat(totalTVA?.total) || 0,
        totalPayments: parseFloat(totalPayments?.total) || 0,
        totalArticles: parseInt(totalArticles?.total) || 0
    };
}

/**
 * Get top selling products between dates
 */
async function getTopProducts(startDate, endDate, limit = 10) {
    // Get products from commandes
    const commandeProducts = await AppDataSource.createQueryBuilder()
        .select("article.id", "id")
        .addSelect("article.reference", "reference")
        .addSelect("article.designation", "designation")
        .addSelect("article.nom", "nom")
        .addSelect("SUM(articles.quantite)", "totalQuantity")
        .addSelect("SUM(articles.quantite * articles.prixUnitaire)", "totalHT")
        .from(BonCommandeClientArticle, "articles")
        .leftJoin("articles.article", "article")
        .leftJoin("articles.bonCommandeClient", "bc")
        .where("bc.dateCommande BETWEEN :start AND :end", { start: startDate, end: endDate })
        .groupBy("article.id")
        .addGroupBy("article.reference")
        .addGroupBy("article.designation")
        .addGroupBy("article.nom")
        .orderBy("totalQuantity", "DESC")
        .limit(limit)
        .getRawMany();

    // Get products from ventes comptoire
    const venteProducts = await AppDataSource.createQueryBuilder()
        .select("article.id", "id")
        .addSelect("article.reference", "reference")
        .addSelect("article.designation", "designation")
        .addSelect("article.nom", "nom")
        .addSelect("SUM(articles.quantite)", "totalQuantity")
        .addSelect("SUM(articles.quantite * articles.prixUnitaire)", "totalHT")
        .from(VenteComptoireArticle, "articles")
        .leftJoin("articles.article", "article")
        .leftJoin("articles.venteComptoire", "vc")
        .where("vc.dateCommande BETWEEN :start AND :end", { start: startDate, end: endDate })
        .groupBy("article.id")
        .addGroupBy("article.reference")
        .addGroupBy("article.designation")
        .addGroupBy("article.nom")
        .orderBy("totalQuantity", "DESC")
        .limit(limit)
        .getRawMany();

    // Combine and aggregate results
    const productMap = new Map();

    [...commandeProducts, ...venteProducts].forEach(product => {
        if (productMap.has(product.id)) {
            const existing = productMap.get(product.id);
            existing.totalQuantity += parseInt(product.totalQuantity) || 0;
            existing.totalHT += parseFloat(product.totalHT) || 0;
        } else {
            productMap.set(product.id, {
                id: product.id,
                reference: product.reference,
                designation: product.designation,
                nom: product.nom,
                totalQuantity: parseInt(product.totalQuantity) || 0,
                totalHT: parseFloat(product.totalHT) || 0
            });
        }
    });

    // Convert to array and sort
    const topProducts = Array.from(productMap.values())
        .sort((a, b) => b.totalQuantity - a.totalQuantity)
        .slice(0, limit);

    return topProducts;
}

/**
 * Get top clients by purchase amount between dates
 */
async function getTopClients(startDate, endDate, limit = 10) {
    // Get clients from commandes
    const commandeClients = await AppDataSource.createQueryBuilder()
        .select("client.id", "id")
        .addSelect("client.raison_sociale", "raison_sociale")
        .addSelect("client.designation", "designation")
        .addSelect("client.matricule_fiscal", "matricule_fiscal")
        .addSelect("SUM(bc.totalTTCAfterRemise)", "totalTTC")
        .addSelect("COUNT(bc.id)", "orderCount")
        .from(BonCommandeClient, "bc")
        .leftJoin("bc.client", "client")
        .where("bc.dateCommande BETWEEN :start AND :end", { start: startDate, end: endDate })
        .groupBy("client.id")
        .addGroupBy("client.raison_sociale")
        .addGroupBy("client.designation")
        .addGroupBy("client.matricule_fiscal")
        .orderBy("totalTTC", "DESC")
        .limit(limit)
        .getRawMany();

    // Get clients from factures
    const factureClients = await AppDataSource.createQueryBuilder()
        .select("client.id", "id")
        .addSelect("client.raison_sociale", "raison_sociale")
        .addSelect("client.designation", "designation")
        .addSelect("client.matricule_fiscal", "matricule_fiscal")
        .addSelect("SUM(f.totalTTCAfterRemise)", "totalTTC")
        .addSelect("COUNT(f.id)", "orderCount")
        .from(FactureClient, "f")
        .leftJoin("f.client", "client")
        .where("f.dateFacture BETWEEN :start AND :end", { start: startDate, end: endDate })
        .groupBy("client.id")
        .addGroupBy("client.raison_sociale")
        .addGroupBy("client.designation")
        .addGroupBy("client.matricule_fiscal")
        .orderBy("totalTTC", "DESC")
        .limit(limit)
        .getRawMany();

    // Combine and aggregate results
    const clientMap = new Map();

    [...commandeClients, ...factureClients].forEach(client => {
        if (clientMap.has(client.id)) {
            const existing = clientMap.get(client.id);
            existing.totalTTC += parseFloat(client.totalTTC) || 0;
            existing.orderCount += parseInt(client.orderCount) || 0;
        } else if (client.id) {
            clientMap.set(client.id, {
                id: client.id,
                raison_sociale: client.raison_sociale,
                designation: client.designation,
                matricule_fiscal: client.matricule_fiscal,
                totalTTC: parseFloat(client.totalTTC) || 0,
                orderCount: parseInt(client.orderCount) || 0
            });
        }
    });

    // Convert to array and sort
    const topClients = Array.from(clientMap.values())
        .sort((a, b) => b.totalTTC - a.totalTTC)
        .slice(0, limit);

    return topClients;
}

/**
 * Get monthly trends for charts
 */
async function getMonthlyTrends(startDate, endDate) {
    const monthlyData = [];

    // Generate months between start and end dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    const currentDate = new Date(start);

    while (currentDate <= end) {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        const monthStr = `${year}-${String(month).padStart(2, '0')}`;

        const monthStart = new Date(year, month - 1, 1);
        const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);

        // Get data for this month
        const [facturesTotal, ventesTotal, commandesCount] = await Promise.all([
            AppDataSource.createQueryBuilder()
                .select("SUM(totalTTCAfterRemise)", "total")
                .from(FactureClient, "f")
                .where("dateFacture BETWEEN :start AND :end", { start: monthStart, end: monthEnd })
                .getRawOne(),
            AppDataSource.createQueryBuilder()
                .select("SUM(totalAfterRemise)", "total")
                .from(VenteComptoire, "vc")
                .where("dateCommande BETWEEN :start AND :end", { start: monthStart, end: monthEnd })
                .getRawOne(),
            AppDataSource.createQueryBuilder()
                .select("COUNT(*)", "count")
                .from(BonCommandeClient, "bc")
                .where("dateCommande BETWEEN :start AND :end", { start: monthStart, end: monthEnd })
                .getRawOne()
        ]);

        monthlyData.push({
            month: monthStr,
            monthName: currentDate.toLocaleString('fr-FR', { month: 'long' }),
            year,
            factures: parseFloat(facturesTotal?.total) || 0,
            ventesComptoire: parseFloat(ventesTotal?.total) || 0,
            totalChiffreAffaires: (parseFloat(facturesTotal?.total) || 0) + (parseFloat(ventesTotal?.total) || 0),
            commandesCount: parseInt(commandesCount?.count) || 0
        });

        // Move to next month
        currentDate.setMonth(currentDate.getMonth() + 1);
    }

    return monthlyData;
}

