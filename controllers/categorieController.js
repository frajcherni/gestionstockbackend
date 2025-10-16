


const { AppDataSource } = require('../db');
const { Categorie } = require('../entities/Categorie');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const repo = AppDataSource.getRepository(Categorie);

// Configure multer storage for categories
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/categories/';
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'category-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Create multer instance
const upload = multer({
  storage: storage,
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

// Use this for single file upload with text fields
const uploadMiddleware = upload.single('image');

// In your categorie controller
exports.getAll = async (req, res) => {
  try {
    const list = await repo.find();

    list.forEach(cat => {
      if (cat.parent_id) {
      }
    });
    
    // Add parentName for frontend display
    const categoriesWithParentNames = list.map(cat => {
      let parentName = null;
      if (cat.parent_id) {
        const parent = list.find(p => p.id === cat.parent_id);
        parentName = parent ? parent.nom : 'Unknown';
      }
      
      return {
        ...cat,
        parentName: parentName,
        // Add full URL for images
        image: cat.image ? `${req.protocol}://${req.get('host')}/${cat.image.replace(/\\/g, "/")}` : null
      };
    });
    
  
    
    res.json(categoriesWithParentNames);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};



// In your categorie controller
exports.getAll = async (req, res) => {
  try {
    const list = await repo.find();

 
    
    // Add parentName for frontend display
    const categoriesWithParentNames = list.map(cat => {
      let parentName = null;
      if (cat.parent_id) {
        const parent = list.find(p => p.id === cat.parent_id);
        parentName = parent ? parent.nom : 'Unknown';
      }
      
      return {
        ...cat,
        parentName: parentName
      };
    });
    
    
    res.json(categoriesWithParentNames);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.create = async (req, res) => {
  // First, handle the file upload
  uploadMiddleware(req, res, async function(err) {
    if (err) {
      return res.status(400).json({ message: err.message });
    }

    try {
      
      if (!req.body.nom) {
        // Delete uploaded file if validation fails
        if (req.file) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(400).json({ 
          message: 'Category name is required' 
        });
      }

      // Prepare data - convert empty string to null for parent_id
      const data = {
        nom: req.body.nom,
        description: req.body.description || '',
        parent_id: req.body.parent_id || null, // Convert empty string to null
        image: req.file ? req.file.path : null // Add image path if file uploaded
      };
      

      const newItem = repo.create(data);
      const saved = await repo.save(newItem);
      
      // Add full URL for image in response
      if (saved.image) {
        saved.image = `${req.protocol}://${req.get('host')}/${saved.image.replace(/\\/g, "/")}`;
      }
      
      res.status(201).json(saved);
    } catch (error) {
      // Delete uploaded file if there's an error
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      res.status(400).json({ message: error.message });
    }
  });
};

exports.update = async (req, res) => {
  // First, handle the file upload
  uploadMiddleware(req, res, async function(err) {
    if (err) {
      return res.status(400).json({ message: err.message });
    }

    try {
      const id = parseInt(req.params.id);
      let item = await repo.findOneBy({ id });
      
      if (!item) {
        // Delete uploaded file if category not found
        if (req.file) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(404).json({ message: 'Category not found' });
      }

      // Store old image path for deletion if new image is uploaded
      const oldImagePath = item.image;

      // Prepare data - convert empty string to null for parent_id
      const data = {
        nom: req.body.nom,
        description: req.body.description,
        parent_id: req.body.parent_id || null, // Convert empty string to null
      };

      // Update image if new file is uploaded
      if (req.file) {
        data.image = req.file.path;
        // Delete old image file
        if (oldImagePath && fs.existsSync(oldImagePath)) {
          fs.unlinkSync(oldImagePath);
        }
      }

      repo.merge(item, data);
      const updated = await repo.save(item);
      
      // Add full URL for image in response
      if (updated.image) {
        updated.image = `${req.protocol}://${req.get('host')}/${updated.image.replace(/\\/g, "/")}`;
      }
      
      res.json(updated);
    } catch (error) {
      // Delete uploaded file if there's an error
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      res.status(400).json({ message: error.message });
    }
  });
};

exports.remove = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const item = await repo.findOneBy({ id });
    
    if (!item) {
      return res.status(404).json({ message: 'Category not found' });
    }

    // Delete associated image file if exists
    if (item.image && fs.existsSync(item.image)) {
      fs.unlinkSync(item.image);
    }

    const result = await repo.delete(id);
    if (result.affected === 0) {
      return res.status(404).json({ message: 'Category not found' });
    }
    
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.remove = async (req, res) => {
  const id = parseInt(req.params.id);
  const result = await repo.delete(id);
  if (result.affected === 0)
    return res.status(404).json({ message: 'Not found' });
  res.status(204).send();
};
