const { AppDataSource } = require('../db');
const { Fournisseur } = require('../entities/Fournisseur'); // ✅

exports.getAllFournisseurs = async (req, res) => {
  try {
    const fournisseurs = await AppDataSource.getRepository(Fournisseur).find({
      relations: ['articles'],
      order: { createdAt: 'DESC' }
    });
    res.json(fournisseurs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getFournisseurById = async (req, res) => {
  try {
    const fournisseur = await AppDataSource.getRepository(Fournisseur).findOne({
      where: { id: parseInt(req.params.id) },
      relations: ["articles"]
    });
    
    if (!fournisseur) {
      return res.status(404).json({ message: "Fournisseur not found" });
    }
    
    res.json(fournisseur);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createFournisseur = async (req, res) => {
    try {
        const {
            raison_sociale,
            designation,
            matricule_fiscal,
            register_commerce,
            adresse,
            ville,
            code_postal,
            telephone1,
            telephone2,
            email,
            status
        } = req.body;

        // Validate required fields
   
        const fournisseurRepo = AppDataSource.getRepository(Fournisseur);


        const newFournisseur = fournisseurRepo.create({
            raison_sociale,
            designation: designation || null,
            matricule_fiscal: matricule_fiscal || null,
            register_commerce: register_commerce || null,
            adresse: adresse || null,
            ville: ville || null,
            code_postal: code_postal || null,
            telephone1: telephone1 || null,
            telephone2: telephone2 || null,
            email: email || null,
            status: status || "Actif"
        });

        const result = await fournisseurRepo.save(newFournisseur);
        
        res.status(201).json({
            message: "Fournisseur créé avec succès",
            fournisseur: result
        });

    } catch (err) {
        console.error("Error creating fournisseur:", err);
        res.status(500).json({ 
            message: 'Erreur serveur lors de la création du fournisseur', 
            error: err.message 
        });
    }
};

exports.updateFournisseur = async (req, res) => {
  try {
    const fournisseurRepository = AppDataSource.getRepository(Fournisseur);
    const fournisseur = await fournisseurRepository.findOneBy({ id: parseInt(req.params.id) });
    
    if (!fournisseur) {
      return res.status(404).json({ message: "Fournisseur not found" });
    }

    fournisseurRepository.merge(fournisseur, req.body);
    const result = await fournisseurRepository.save(fournisseur);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.deleteFournisseur = async (req, res) => {
  try {
    const fournisseurRepository = AppDataSource.getRepository(Fournisseur);
    const fournisseur = await fournisseurRepository.findOne({
      where: { id: parseInt(req.params.id) },
      relations: ["articles"]
    });
    
    if (!fournisseur) {
      return res.status(404).json({ message: "Fournisseur not found" });
    }

    if (fournisseur.articles && fournisseur.articles.length > 0) {
      return res.status(400).json({ 
        message: "Cannot delete fournisseur with associated articles" 
      });
    }

    await fournisseurRepository.remove(fournisseur);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};