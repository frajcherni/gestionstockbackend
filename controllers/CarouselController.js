const { AppDataSource } = require("../db");
const { Carousel } = require("../entities/Carousel");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const carouselRepo = AppDataSource.getRepository(Carousel);

// Multer config for carousel images
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = "uploads/carousel/";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "banner-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only images are allowed"), false);
  }
});

const uploadMiddleware = upload.single("image");

exports.getAll = async (req, res) => {
  try {
    const slides = await carouselRepo.find({
      order: { order: "ASC" }
    });
    
    const formatted = slides.map(s => ({
      ...s,
      image: `${req.protocol}://${req.get("host")}/${s.image.replace(/\\/g, "/")}`
    }));
    
    res.json(formatted);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.create = async (req, res) => {
  uploadMiddleware(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message });
    if (!req.file) return res.status(400).json({ message: "No image uploaded" });

    try {
      const data = {
        image: req.file.path,
        title: req.body.title || "",
        subtitle: req.body.subtitle || "",
        link: req.body.link || "",
        order: parseInt(req.body.order) || 0,
        active: req.body.active === 'true' || req.body.active === true
      };

      const newItem = carouselRepo.create(data);
      const saved = await carouselRepo.save(newItem);
      
      saved.image = `${req.protocol}://${req.get("host")}/${saved.image.replace(/\\/g, "/")}`;
      res.status(201).json(saved);
    } catch (error) {
      if (req.file) fs.unlinkSync(req.file.path);
      res.status(500).json({ message: error.message });
    }
  });
};

exports.update = async (req, res) => {
  uploadMiddleware(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message });

    try {
      const id = parseInt(req.params.id);
      const item = await carouselRepo.findOneBy({ id });
      if (!item) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(404).json({ message: "Not found" });
      }

      const oldImage = item.image;
      const data = {
        title: req.body.title !== undefined ? req.body.title : item.title,
        subtitle: req.body.subtitle !== undefined ? req.body.subtitle : item.subtitle,
        link: req.body.link !== undefined ? req.body.link : item.link,
        order: req.body.order !== undefined ? parseInt(req.body.order) : item.order,
        active: req.body.active !== undefined ? (req.body.active === 'true' || req.body.active === true) : item.active
      };

      if (req.file) {
        data.image = req.file.path;
        if (fs.existsSync(oldImage)) fs.unlinkSync(oldImage);
      }

      carouselRepo.merge(item, data);
      const updated = await carouselRepo.save(item);
      
      updated.image = `${req.protocol}://${req.get("host")}/${updated.image.replace(/\\/g, "/")}`;
      res.json(updated);
    } catch (error) {
      if (req.file) fs.unlinkSync(req.file.path);
      res.status(500).json({ message: error.message });
    }
  });
};

exports.remove = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const item = await carouselRepo.findOneBy({ id });
    if (!item) return res.status(404).json({ message: "Not found" });

    if (fs.existsSync(item.image)) fs.unlinkSync(item.image);
    await carouselRepo.remove(item);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
