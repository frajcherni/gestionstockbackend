const { AppDataSource } = require('../db');
const { Vendeur } = require('../entities/Vendeur');

// Create a new salesperson
exports.createVendeur = async (req, res) => {
    try {
        const { nom, prenom, telephone, email, commission } = req.body;

        if ( !prenom) {
            return res.status(400).json({ message: 'Nom and prenom are required' });
        }

        const vendeurRepo = AppDataSource.getRepository(Vendeur);
        const newVendeur = vendeurRepo.create({
            nom,
            prenom,
            telephone,
            email,
            commission: commission || 0
        });

        const result = await vendeurRepo.save(newVendeur);
        res.status(201).json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

// Get all salespeople
exports.getAllVendeurs = async (req, res) => {
    try {
        const vendeurRepo = AppDataSource.getRepository(Vendeur);
        const vendeurs = await vendeurRepo.find();
        res.json(vendeurs);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
};

// Get a single salesperson by ID
exports.getVendeurById = async (req, res) => {
    try {
        const vendeurRepo = AppDataSource.getRepository(Vendeur);
        const vendeur = await vendeurRepo.findOneBy({ id: parseInt(req.params.id) });

        if (!vendeur) {
            return res.status(404).json({ message: 'Salesperson not found' });
        }

        res.json(vendeur);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
};

// Update a salesperson
exports.updateVendeur = async (req, res) => {
    try {
        const vendeurRepo = AppDataSource.getRepository(Vendeur);
        const vendeur = await vendeurRepo.findOneBy({ id: parseInt(req.params.id) });

        if (!vendeur) {
            return res.status(404).json({ message: 'Salesperson not found' });
        }

        // Clean the request body - convert empty strings to null/0
        const cleanedBody = { ...req.body };
        
        // Convert empty strings to null for string fields
        if (cleanedBody.nom === '') cleanedBody.nom = null;
        if (cleanedBody.prenom === '') cleanedBody.prenom = null;
        if (cleanedBody.telephone === '') cleanedBody.telephone = null;
        if (cleanedBody.email === '') cleanedBody.email = null;
        
        // Convert empty string to 0 for numeric fields
        if (cleanedBody.commission === '') cleanedBody.commission = 0;
        if (cleanedBody.commission !== undefined) {
            cleanedBody.commission = parseFloat(cleanedBody.commission) || 0;
        }

        console.log("=== DEBUG: Updating Vendeur ===");
        console.log("Original body:", req.body);
        console.log("Cleaned body:", cleanedBody);

        vendeurRepo.merge(vendeur, cleanedBody);
        const result = await vendeurRepo.save(vendeur);
        
        console.log("Update successful:", result);
        res.json(result);
    } catch (err) {
        console.error("=== ERROR in updateVendeur ===");
        console.error("Error:", err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

// Delete a salesperson
exports.deleteVendeur = async (req, res) => {
    try {
        const vendeurId = parseInt(req.params.id);
        console.log("=== DEBUG: Deleting Vendeur ===");
        console.log("Vendeur ID:", vendeurId);
        console.log("Request params:", req.params);

        const vendeurRepo = AppDataSource.getRepository(Vendeur);
        
        // First, check if the vendeur exists
        const existingVendeur = await vendeurRepo.findOne({
            where: { id: vendeurId }
        });
        
        console.log("Existing vendeur:", existingVendeur);

        if (!existingVendeur) {
            console.log("Vendeur not found with ID:", vendeurId);
            return res.status(404).json({ message: 'Salesperson not found' });
        }

        const result = await vendeurRepo.delete(vendeurId);
        console.log("Delete result:", result);

        if (result.affected === 0) {
            console.log("No rows affected - vendeur might not exist");
            return res.status(404).json({ message: 'Salesperson not found' });
        }

        console.log("Vendeur deleted successfully");
        res.status(200).json({ message: 'Salesperson deleted successfully' });
    } catch (err) {
        console.error("=== ERROR in deleteVendeur ===");
        console.error("Error name:", err.name);
        console.error("Error message:", err.message);
        console.error("Error stack:", err.stack);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};
// Get salesperson statistics (optional)
exports.getVendeurStats = async (req, res) => {
    try {
        const vendeurRepo = AppDataSource.getRepository(Vendeur);
        const bonCommandeRepo = AppDataSource.getRepository('BonCommandeClient');

        const vendeur = await vendeurRepo.findOneBy({ id: parseInt(req.params.id) });
        if (!vendeur) {
            return res.status(404).json({ message: 'Salesperson not found' });
        }

        // Get total sales count
        const salesCount = await bonCommandeRepo.count({
            where: { vendeur: { id: parseInt(req.params.id) } }
        });

        // Get total sales amount (example)
        // This would require a more complex query with joins

        res.json({
            vendeur,
            salesCount,
            // totalSalesAmount
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
};