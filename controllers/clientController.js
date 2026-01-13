const { AppDataSource } = require('../db');
const { Client } = require('../entities/Client');

exports.getAllClients = async (req, res) => {
  try {
    const clients = await AppDataSource.getRepository(Client).find({
    //  relations: ['commandes'],
      order: { createdAt: 'DESC' }
    });
    res.json(clients);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getClientById = async (req, res) => {
  try {
    const client = await AppDataSource.getRepository(Client).findOne({
      where: { id: parseInt(req.params.id) },
      //relations: ['commandes']
    });

    if (!client) {
      return res.status(404).json({ message: 'Client not found' });
    }

    res.json(client);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createClient = async (req, res) => {
  try {
    const requiredFields = [
      'raison_sociale', 
      'matricule_fiscal', 
      'register_commerce',
      'adresse',
      'ville',
      'code_postal',
      'telephone1',
      'email'
    ];

 

    const clientRepository = AppDataSource.getRepository(Client);
    const newClient = clientRepository.create(req.body);
    const result = await clientRepository.save(newClient);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.updateClient = async (req, res) => {
  try {
    const clientRepository = AppDataSource.getRepository(Client);
    const client = await clientRepository.findOneBy({ id: parseInt(req.params.id) });

    if (!client) {
      return res.status(404).json({ message: 'Client not found' });
    }

    clientRepository.merge(client, req.body);
    const result = await clientRepository.save(client);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.deleteClient = async (req, res) => {
  try {
    const clientRepository = AppDataSource.getRepository(Client);
    const client = await clientRepository.findOne({
      where: { id: parseInt(req.params.id) },
     // relations: ['commandes']
    });

    if (!client) {
      return res.status(404).json({ message: 'Client not found' });
    }

    if (client.commandes && client.commandes.length > 0) {
      return res.status(400).json({
        message: 'Cannot delete client with associated orders'
      });
    }

    await clientRepository.remove(client);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};



// Add this to your clientController.js
exports.searchClients = async (req, res) => {
  try {
    // --- Read body parameters ---
    const q = typeof req.body.q === "string" ? req.body.q.trim() : "";
    
    // --- Optional status filter ---
    const status = typeof req.body.status === "string" ? req.body.status.trim() : "Actif";

    // --- Optional pagination (safe defaults) ---
    let pageNumber = parseInt(req.body.page, 10);
    let limitNumber = parseInt(req.body.limit, 10);

    if (isNaN(pageNumber) || pageNumber < 1) pageNumber = 1;
    if (isNaN(limitNumber) || limitNumber < 1) limitNumber = 20;

    limitNumber = Math.min(limitNumber, 100);
    const offset = (pageNumber - 1) * limitNumber;

    const repo = AppDataSource.getRepository(Client);

    // --- Query only the safe fields (no unnecessary joins) ---
    const qb = repo.createQueryBuilder("client")
      .select([
        "client.id",
        "client.numero",
        "client.raison_sociale",
        "client.designation",
        "client.matricule_fiscal",
        "client.register_commerce",
        "client.adresse",
        "client.ville",
        "client.code_postal",
        "client.telephone1",
        "client.telephone2",
        "client.telephone3",
        "client.telephone4",
        "client.email",
        "client.site_web",
        "client.commentaire",
        "client.nature",
        "client.timbre",
        "client.exonere",
        "client.permanent",
        "client.solde",
        "client.tau_rem",
        "client.passager",
        "client.status",
        "client.poste",
        "client.utilisateur",
        "client.date_creation",
        "client.date_maj",
        "client.heure_maj",
        "client.path_sigle",
        "client.sigle",
        "client.createdAt",
        "client.updatedAt"
      ]);

    // --- Apply status filter if provided ---
    if (status) {
      qb.where("client.status = :status", { status });
    }

    // --- Search by multiple fields ---
    if (q !== "") {
      const searchTerm = `%${q}%`;
      const cleanPhoneTerm = q.replace(/\s/g, ''); // Remove spaces for phone search
      
      qb.andWhere(
        `(client.raison_sociale ILIKE :search OR 
          client.designation ILIKE :search OR 
          REPLACE(client.telephone1, ' ', '') ILIKE :phone OR 
          REPLACE(client.telephone2, ' ', '') ILIKE :phone OR 
          client.matricule_fiscal ILIKE :search OR 
          client.email ILIKE :search)`,
        { 
          search: searchTerm,
          phone: `%${cleanPhoneTerm}%`
        }
      );
    }

    // --- Get total matching count ---
    const total = await qb.clone().getCount();

    // --- Apply pagination and ordering ---
    const clients = await qb
      .orderBy("client.raison_sociale", "ASC")
      .offset(offset)
      .limit(limitNumber)
      .getMany();

    // --- No need to modify URLs for clients (no image field) ---
    res.json({
      clients,
      total,
      page: pageNumber,
      limit: limitNumber,
      totalPages: Math.ceil(total / limitNumber)
    });

  } catch (error) {
    console.error("CLIENT SEARCH ERROR:", error);
    res.status(500).json({ 
      message: "Erreur lors de la recherche des clients",
      error: error.message 
    });
  }
};