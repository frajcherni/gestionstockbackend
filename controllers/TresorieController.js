// controllers/TresorieController.js
const { AppDataSource } = require("../db");
const { VenteComptoire } = require("../entities/VenteComptoire");
const { EncaissementClient } = require("../entities/EncaissementClient");
const { FactureFournisseurPayment } = require("../entities/FactureFournisseurPayment");
const { FactureClient } = require("../entities/FactureClient");
const { BonCommandeClient } = require("../entities/BonCommandeClient");
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
        const paiementClientRepo = AppDataSource.getRepository(PaiementClient);

        // Fetch data with proper relations
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
            paiementClientRepo.find({
                where: {
                    date: Between(start, end)
                },
                relations: ['client', 'bonCommandeClient', 'bonCommandeClient.client']
            })
        ]);

        // Initialize payment methods by source (INCLUDING retenue)
        const bcPayments = { especes: 0, cheque: 0, virement: 0, traite: 0, autre: 0, retenue: 0 };
        const facturePayments = { especes: 0, cheque: 0, virement: 0, traite: 0, autre: 0, retenue: 0 };
        const ventePayments = { especes: 0, cheque: 0, virement: 0, traite: 0, autre: 0, retenue: 0 };
        
        // Calculate totals and process payment methods
        let totalEncaissementFacture = 0;
        let totalEncaissementBC = 0;
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
        // Process paiements BC (PaiementClient)
        paiementsBC.forEach(paiement => {
            let paiementAmount = 0;
            const paymentDetails = [];

            if (paiement.paymentMethods && paiement.paymentMethods.length > 0) {
                paiement.paymentMethods.forEach(payment => {
                    const amount = Number(payment.amount || 0);
                    const method = payment.method || '';
                    
                    paiementAmount += amount;
                    
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
            } else {
                // Legacy modePaiement field
                if (paiement.modePaiement) {
                    const amount = Number(paiement.montant || 0);
                    const method = paiement.modePaiement;
                    
                    paiementAmount += amount;
                    
                    if (isRetention(method)) {
                        bcPayments.retenue += amount;
                    } else {
                        const methodKey = method.toLowerCase();
                        if (bcPayments[methodKey] !== undefined) {
                            bcPayments[methodKey] += amount;
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
                totalEncaissementBC += paiementAmount;
                totalPaiementsClients += paiementAmount;

                const documentClient = paiement.bonCommandeClient?.client || null;
                const clientInfo = getClientInfo(paiement.client, documentClient);

                transactions.push({
                    id: paiement.id,
                    type: 'paiement_bc',
                    numero: paiement.numeroPaiement,
                    numeroPaiement: paiement.numeroPaiement,
                    date: paiement.date,
                    client: clientInfo.client,
                    clientObj: clientInfo.clientObj,
                    montant: paiementAmount,
                    paymentMethods: paymentDetails,
                    hasRetenue: paiement.hasRetenue,
                    montantRetenue: paiement.montantRetenue || 0,
                    source: paiement.bonCommandeClient ? `BC ${paiement.bonCommandeClient.numeroCommande}` : 'Direct',
                    bonCommandeClient: paiement.bonCommandeClient
                });
            }

            // Handle retenue from montantRetenue field
            if (paiement.hasRetenue && paiement.montantRetenue > 0) {
                const retenueAmount = Number(paiement.montantRetenue || 0);
                bcPayments.retenue += retenueAmount;
                
                const documentClient = paiement.bonCommandeClient?.client || null;
                const clientInfo = getClientInfo(paiement.client, documentClient);

                transactions.push({
                    id: `paiement_${paiement.id}_retenue`,
                    type: 'paiement_bc',
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
                    source: paiement.bonCommandeClient ? `BC ${paiement.bonCommandeClient.numeroCommande}` : 'Direct',
                    bonCommandeClient: paiement.bonCommandeClient
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
            especes: bcPayments.especes + facturePayments.especes + ventePayments.especes,
            cheque: bcPayments.cheque + facturePayments.cheque + ventePayments.cheque,
            virement: bcPayments.virement + facturePayments.virement + ventePayments.virement,
            traite: bcPayments.traite + facturePayments.traite + ventePayments.traite,
            autre: bcPayments.autre + facturePayments.autre + ventePayments.autre,
            retenue: bcPayments.retenue + facturePayments.retenue + ventePayments.retenue
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