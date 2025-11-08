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
