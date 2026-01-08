const { AppDataSource } = require("../db");
const { Article } = require("../entities/Article");

const { Fournisseur } = require("../entities/Fournisseur");
const { Categorie } = require("../entities/Categorie");

const multer = require("multer");

const path = require("path");
const fs = require("fs");

// Configure multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = "uploads/articles/";
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "article-" + uniqueSuffix + path.extname(file.originalname));
  },
});

// Create multer instance
const upload = multer({
  storage: storage,
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed!"), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

// Use this for single file upload with text fields
const uploadMiddleware = upload.single("image");

exports.createArticle = async (req, res) => {
  uploadMiddleware(req, res, async function (err) {
    if (err) {
      return res.status(400).json({ message: err.message });
    }

    try {
      console.log("=== REQUEST BODY ===", req.body);

      const fournisseurRepo = AppDataSource.getRepository(Fournisseur);
      const categorieRepo = AppDataSource.getRepository(Categorie);
      const articleRepo = AppDataSource.getRepository(Article);

      let fournisseur = null;
      let categorie = null;

      // Load fournisseur if provided
      if (req.body.fournisseur_id) {
        fournisseur = await fournisseurRepo.findOneBy({
          id: parseInt(req.body.fournisseur_id),
        });
      }

      // Load categorie if provided
      if (req.body.categorie_id) {
        categorie = await categorieRepo.findOneBy({
          id: parseInt(req.body.categorie_id),
        });
      }

      // Handle sousCategorie if provided
      let sousCategorie = null;
      if (req.body.sous_categorie_id) {
        sousCategorie = await categorieRepo.findOneBy({
          id: parseInt(req.body.sous_categorie_id),
        });
      }

      // GET THE NEXT AVAILABLE ID
      const maxIdResult = await AppDataSource.query(
        "SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM articles"
      );
      const nextId = parseInt(maxIdResult[0].next_id);

      console.log(`📌 Next available ID: ${nextId}`);

      // Generate PROPER 13-digit EAN-13 barcode
      let codeBarre = null;
      if (nextId) {
        // Use "330" as prefix (France country code) for consistency with existing barcodes
        const countryCode = "330"; // France EAN prefix

        // Create 9-digit product number from ID (pad to 9 digits)
        const productNumber = nextId.toString().padStart(9, "0");

        // Combine to create 12-digit base (3 + 9 = 12)
        const baseNumber = countryCode + productNumber; // 12 digits

        // Calculate EAN-13 checksum
        let sum = 0;
        for (let i = 0; i < baseNumber.length; i++) {
          const digit = parseInt(baseNumber.charAt(i));
          // EAN-13: positions counted from RIGHT, odd=1, even=3
          const positionFromRight = baseNumber.length - i;
          const multiplier = positionFromRight % 2 === 0 ? 3 : 1;
          sum += digit * multiplier;
        }

        // Calculate checksum digit (0-9)
        const checksum = (10 - (sum % 10)) % 10;

        // Final 13-digit barcode
        codeBarre = baseNumber + checksum.toString();

        console.log(`✅ Generated 13-digit EAN-13: ${codeBarre}`);
        console.log(`📊 Format: ${countryCode}-${productNumber}-${checksum}`);

        // Validate it's exactly 13 digits
        if (codeBarre.length !== 13) {
          console.warn(
            `⚠️ Warning: Barcode length is ${codeBarre.length}, expected 13`
          );
        }
      }

      const article = articleRepo.create({
        id: nextId,
        reference: req.body.reference || "",
        designation: req.body.designation || "",
        nom: req.body.nom || req.body.designation || req.body.reference || "",
        qte: parseInt(req.body.qte) || 0,
        qte_virtual: parseInt(req.body.qte) || 0,
        pua_ht: parseFloat(req.body.pua_ht) || 0,
        puv_ht: parseFloat(req.body.puv_ht) || 0,
        pua_ttc: parseFloat(req.body.pua_ttc) || 0,
        puv_ttc: parseFloat(req.body.puv_ttc) || 0,
        tva: parseInt(req.body.tva) || 0,
        taux_fodec:
          req.body.taux_fodec === "true" || req.body.taux_fodec === true,
        type: req.body.type || "Non Consigné",
        code_barre: codeBarre,
        code_barres: codeBarre ? [codeBarre] : [],
        fournisseur,
        categorie,
        sousCategorie,
        image: req.file ? req.file.path : null,
      });

      const savedArticle = await articleRepo.save(article);
      console.log("✅ Article saved with ID:", savedArticle.id);

      // Add full URL for image in response
      if (savedArticle.image) {
        savedArticle.image = `${req.protocol}://${req.get("host")}/${
          savedArticle.image
        }`;
      }

      res.status(201).json(savedArticle);
    } catch (error) {
      console.error("❌ Error creating article:", error);
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ message: error.message });
    }
  });
};

exports.updateArticle = async (req, res) => {
  // First, handle the file upload
  uploadMiddleware(req, res, async function (err) {
    if (err) {
      return res.status(400).json({ message: err.message });
    }

    try {
      const articleRepository = AppDataSource.getRepository(Article);
      const fournisseurRepository = AppDataSource.getRepository(Fournisseur);
      const categorieRepository = AppDataSource.getRepository(Categorie);

      const article = await articleRepository.findOne({
        where: { id: parseInt(req.params.id) },
        relations: ["categorie", "fournisseur", "sousCategorie"],
      });

      if (!article) {
        // Delete uploaded file if article not found
        if (req.file) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(404).json({ message: "Article not found" });
      }

      console.log("=== UPDATE REQUEST BODY ===", req.body);
      console.log("=== UPDATE REQUEST FILE ===", req.file);

      const {
        reference,
        designation,
        pua_ttc,
        puv_ttc,
        pua_ht,
        puv_ht,
        tva,
        taux_fodec,
        type,
        qte,
        nom,
        fournisseur_id,
        categorie_id,
        sous_categorie_id,
      } = req.body;

      // Store old image path for deletion if new image is uploaded
      const oldImagePath = article.image;
      if (fournisseur_id) {
        const fournisseur = await fournisseurRepository.findOneBy({
          id: parseInt(fournisseur_id),
        });
        if (!fournisseur) {
          // Delete uploaded file if validation fails
          if (req.file) {
            fs.unlinkSync(req.file.path);
          }
          return res.status(400).json({ message: "Invalid fournisseur_id" });
        }
        article.fournisseur = fournisseur;
      }

      if (categorie_id) {
        const categorie = await categorieRepository.findOneBy({
          id: parseInt(categorie_id),
        });
        if (!categorie) {
          // Delete uploaded file if validation fails
          if (req.file) {
            fs.unlinkSync(req.file.path);
          }
          return res.status(400).json({ message: "Invalid categorie_id" });
        }
        article.categorie = categorie;
      }

      // Handle subcategory
      if (sous_categorie_id) {
        const sousCategorie = await categorieRepository.findOneBy({
          id: parseInt(sous_categorie_id),
        });
        article.sousCategorie = sousCategorie;
      } else {
        article.sousCategorie = null;
      }

      article.reference = reference ?? article.reference;
      article.designation = designation ?? article.designation;
      article.pua_ttc = pua_ttc ? parseFloat(pua_ttc) : article.pua_ttc;
      article.puv_ttc = puv_ttc ? parseFloat(puv_ttc) : article.puv_ttc;
      article.pua_ht = pua_ht ? parseFloat(pua_ht) : article.pua_ht;
      article.puv_ht = puv_ht ? parseFloat(puv_ht) : article.puv_ht;
      article.tva = tva ? parseInt(tva) : article.tva;
      article.taux_fodec = taux_fodec
        ? taux_fodec === "true" || taux_fodec === true
        : article.taux_fodec;
      article.type = type ?? article.type;
      article.qte = qte ? parseInt(qte) : article.qte;
      article.nom = nom ?? article.nom;

      // Update image if new file is uploaded
      if (req.file) {
        article.image = req.file.path;
        // Delete old image file
        if (oldImagePath && fs.existsSync(oldImagePath)) {
          fs.unlinkSync(oldImagePath);
        }
      }

      const result = await articleRepository.save(article);

      // Add full URL for image in response
      if (result.image) {
        result.image = `${req.protocol}://${req.get("host")}/${result.image}`;
      }

      res.json(result);
    } catch (error) {
      // Delete uploaded file if there's an error
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      res.status(400).json({ message: error.message });
    }
  });
};

exports.getAllArticles = async (req, res) => {
  try {
    const articles = await AppDataSource.getRepository(Article).find({
      relations: ["categorie", "fournisseur", "sousCategorie"],
    });

    // Add full URL for images
    const articlesWithImageUrl = articles.map((article) => ({
      ...article,
      image: article.image
        ? `${req.protocol}://${req.get("host")}/${article.image}`
        : null,
    }));

    res.json(articlesWithImageUrl);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getArticleById = async (req, res) => {
  try {
    const article = await AppDataSource.getRepository(Article).findOne({
      where: { id: parseInt(req.params.id) },
      relations: ["categorie", "fournisseur", "sousCategorie"],
    });

    if (!article) {
      return res.status(404).json({ message: "Article not found" });
    }

    // Add full URL for image
    if (article.image) {
      article.image = `${req.protocol}://${req.get("host")}/${article.image}`;
    }

    res.json(article);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateArticle = async (req, res) => {
  // First, handle the file upload
  uploadMiddleware(req, res, async function (err) {
    if (err) {
      return res.status(400).json({ message: err.message });
    }

    try {
      const articleRepository = AppDataSource.getRepository(Article);
      const fournisseurRepository = AppDataSource.getRepository(Fournisseur);
      const categorieRepository = AppDataSource.getRepository(Categorie);

      const article = await articleRepository.findOne({
        where: { id: parseInt(req.params.id) },
        relations: ["categorie", "fournisseur", "sousCategorie"],
      });

      if (!article) {
        // Delete uploaded file if article not found
        if (req.file) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(404).json({ message: "Article not found" });
      }

      console.log("=== UPDATE REQUEST BODY ===", req.body);
      console.log("=== UPDATE REQUEST FILE ===", req.file);

      const {
        reference,
        designation,
        pua_ttc,
        puv_ttc,
        pua_ht,
        puv_ht,
        tva,
        taux_fodec,
        type,
        qte,
        nom,
        fournisseur_id,
        categorie_id,
        sous_categorie_id,
      } = req.body;

      // Store old image path for deletion if new image is uploaded
      const oldImagePath = article.image;
      if (fournisseur_id) {
        const fournisseur = await fournisseurRepository.findOneBy({
          id: parseInt(fournisseur_id),
        });
        if (!fournisseur) {
          // Delete uploaded file if validation fails
          if (req.file) {
            fs.unlinkSync(req.file.path);
          }
          return res.status(400).json({ message: "Invalid fournisseur_id" });
        }
        article.fournisseur = fournisseur;
      }

      if (categorie_id) {
        const categorie = await categorieRepository.findOneBy({
          id: parseInt(categorie_id),
        });
        if (!categorie) {
          // Delete uploaded file if validation fails
          if (req.file) {
            fs.unlinkSync(req.file.path);
          }
          return res.status(400).json({ message: "Invalid categorie_id" });
        }
        article.categorie = categorie;
      }

      // Handle subcategory
      if (sous_categorie_id) {
        const sousCategorie = await categorieRepository.findOneBy({
          id: parseInt(sous_categorie_id),
        });
        article.sousCategorie = sousCategorie;
      } else {
        article.sousCategorie = null;
      }

      article.reference = reference ?? article.reference;
      article.designation = designation ?? article.designation;
      article.pua_ttc = pua_ttc ? parseFloat(pua_ttc) : article.pua_ttc;
      article.puv_ttc = puv_ttc ? parseFloat(puv_ttc) : article.puv_ttc;
      article.pua_ht = pua_ht ? parseFloat(pua_ht) : article.pua_ht;
      article.puv_ht = puv_ht ? parseFloat(puv_ht) : article.puv_ht;
      article.tva = tva ? parseInt(tva) : article.tva;
      article.taux_fodec = taux_fodec
        ? taux_fodec === "true" || taux_fodec === true
        : article.taux_fodec;
      article.type = type ?? article.type;
      article.qte = qte ? parseInt(qte) : article.qte;
      article.nom = nom ?? article.nom;

      // Update image if new file is uploaded
      if (req.file) {
        article.image = req.file.path;
        // Delete old image file
        if (oldImagePath && fs.existsSync(oldImagePath)) {
          fs.unlinkSync(oldImagePath);
        }
      }

      const result = await articleRepository.save(article);

      // Add full URL for image in response
      if (result.image) {
        result.image = `${req.protocol}://${req.get("host")}/${result.image}`;
      }

      res.json(result);
    } catch (error) {
      // Delete uploaded file if there's an error
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      res.status(400).json({ message: error.message });
    }
  });
};

exports.deleteArticle = async (req, res) => {
  try {
    const result = await AppDataSource.getRepository(Article).delete(
      req.params.id
    );

    if (result.affected === 0) {
      return res.status(404).json({ message: "Article not found" });
    }

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getAllArticles = async (req, res) => {
  try {
    const articles = await AppDataSource.getRepository(Article).find({
      relations: ["categorie", "fournisseur", "sousCategorie"],
    });
    res.json(articles);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getArticleById = async (req, res) => {
  try {
    const article = await AppDataSource.getRepository(Article).findOne({
      where: { id: parseInt(req.params.id) },
      relations: ["categorie", "fournisseur"],
    });

    if (!article) {
      return res.status(404).json({ message: "Article not found" });
    }

    res.json(article);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateArticleWebsiteSettings = async (req, res) => {
  try {
    const { id } = req.params;
    const { on_website, is_offre, is_top_seller, is_new_arrival, Description } =
      req.body;

    const articleRepo = AppDataSource.getRepository(Article);

    const article = await articleRepo.findOne({
      where: { id: parseInt(id) },
    });

    if (!article) {
      return res.status(404).json({ message: "Article not found" });
    }

    // Update website settings
    article.on_website = on_website;
    article.is_offre = is_offre;
    article.is_top_seller = is_top_seller;
    article.is_new_arrival = is_new_arrival;
    article.website_description = Description;
    article.updated_at = new Date();

    const updatedArticle = await articleRepo.save(article);

    res.json(updatedArticle);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Configure multer for website images (multiple files)
const websiteStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = "uploads/website-images/";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "website-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const uploadWebsiteImages = multer({
  storage: websiteStorage,
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed!"), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

const uploadWebsiteMiddleware = uploadWebsiteImages.array("images", 10);

exports.uploadWebsiteImages = async (req, res) => {
  // Use the upload middleware
  uploadWebsiteMiddleware(req, res, async function (err) {
    if (err) {
      return res.status(400).json({ message: err.message });
    }

    try {
      const { id } = req.params;

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: "No images uploaded" });
      }

      const articleRepo = AppDataSource.getRepository(Article);
      const article = await articleRepo.findOne({
        where: { id: parseInt(id) },
      });

      if (!article) {
        // Delete uploaded files if article not found
        req.files.forEach((file) => {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        });
        return res.status(404).json({ message: "Article not found" });
      }

      // Generate file paths
      const newImages = req.files.map((file) => file.path);

      // Add new images to existing ones
      const currentImages = article.website_images || [];
      const updatedImages = [...currentImages, ...newImages];

      article.website_images = updatedImages;
      article.updated_at = new Date();

      const updatedArticle = await articleRepo.save(article);

      res.json({
        message: "Images uploaded successfully",
        images: newImages,
        article: updatedArticle,
      });
    } catch (error) {
      // Clean up uploaded files on error
      if (req.files) {
        req.files.forEach((file) => {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        });
      }
      res.status(500).json({ message: error.message });
    }
  });
};

exports.removeWebsiteImage = async (req, res) => {
  try {
    const { id, imageIndex } = req.params;
    const index = parseInt(imageIndex);

    const articleRepo = AppDataSource.getRepository(Article);
    const article = await articleRepo.findOne({ where: { id: parseInt(id) } });

    if (!article) {
      return res.status(404).json({ message: "Article not found" });
    }

    const currentImages = article.website_images || [];

    if (index < 0 || index >= currentImages.length) {
      return res.status(400).json({ message: "Invalid image index" });
    }

    // Remove image from array
    const imageToRemove = currentImages[index];
    const updatedImages = currentImages.filter((_, i) => i !== index);

    article.website_images = updatedImages;
    article.updated_at = new Date();

    const updatedArticle = await articleRepo.save(article);

    // Delete physical file
    if (fs.existsSync(imageToRemove)) {
      fs.unlinkSync(imageToRemove);
    }

    res.json({
      message: "Image removed successfully",
      article: updatedArticle,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
