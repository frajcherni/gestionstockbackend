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

        vendeurRepo.merge(vendeur, req.body);
        const result = await vendeurRepo.save(vendeur);
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

// Delete a salesperson
exports.deleteVendeur = async (req, res) => {
    try {
        const vendeurRepo = AppDataSource.getRepository(Vendeur);
        const result = await vendeurRepo.delete(parseInt(req.params.id));

        if (result.affected === 0) {
            return res.status(404).json({ message: 'Salesperson not found' });
        }

        res.status(200).json({ message: 'Salesperson deleted successfully' });
    } catch (err) {
        console.error(err);
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