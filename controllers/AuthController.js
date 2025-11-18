const multer = require("multer");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { AppDataSource } = require("../db");
const User = require("../entities/User");

const userRepo = AppDataSource.getRepository("User");

// Register
exports.register = async (req, res) => {
  try {
    const { username, password, first_name, last_name, role } = req.body;

    if (!username || !password)
      return res
        .status(400)
        .json({ message: "Username and password required" });

    const existingUser = await userRepo.findOneBy({ username });
    if (existingUser)
      return res.status(400).json({ message: "Username already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = userRepo.create({
      username,
      password: hashedPassword,
      first_name,
      last_name,
      role: role || "user",
    });

    await userRepo.save(user);

    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log(username, password);

    const user = await userRepo.findOneBy({ username });
    if (!user) return res.status(404).json({ message: "User not found" });

    // Direct password check without bcrypt
    if (user.password !== password) {
      return res.status(401).json({ message: "Invalid password" });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    // Return user object with token and full_name
    const userResponse = {
      id: user.id,
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
      full_name: `${user.first_name} ${user.last_name}`,
      role: user.role,
      is_active: user.is_active,
      company_name: user.company_name,
      company_address: user.company_address,
      company_city: user.company_city,
      company_phone: user.company_phone,
      company_gsm: user.company_gsm, // Added GSM field
      company_email: user.company_email,
      company_website: user.company_website,
      company_tax_id: user.company_tax_id,
      company_matricule_fiscal: user.company_matricule_fiscal,
      company_logo: user.company_logo,
      created_at: user.created_at,
      updated_at: user.updated_at,
      token,
    };

    res.json({ user: userResponse });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

const uploadsDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Simple multer setup
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage: storage });

// Update profile with image
exports.updateProfile = async (req, res) => {
  try {
    const {
      id,
      username,
      first_name,
      last_name,
      company_name,
      company_address,
      company_city,
      company_phone,
      company_gsm, // Added GSM field
      company_email,
      company_website,
      company_tax_id,
    } = req.body;

    console.log(id);
    const userId = parseInt(id);
    if (isNaN(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const user = await userRepo.findOneBy({ id: userId });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Update user fields
    user.username = username || user.username;
    user.first_name = first_name || user.first_name;
    user.last_name = last_name || user.last_name;
    user.company_name = company_name || user.company_name;
    user.company_address = company_address || user.company_address;
    user.company_city = company_city || user.company_city;
    user.company_phone = company_phone || user.company_phone;
    user.company_gsm = company_gsm || user.company_gsm; // Added GSM field
    user.company_email = company_email || user.company_email;
    user.company_website = company_website || user.company_website;
    user.company_tax_id = company_tax_id || user.company_tax_id;
    // Handle image upload
    if (req.file) {
      user.company_logo = req.file.filename;
    }

    user.updated_at = new Date();

    await userRepo.save(user);

    // Return updated user
    const updatedUser = {
      id: user.id,
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
      full_name: `${user.first_name} ${user.last_name}`,
      company_name: user.company_name,
      company_address: user.company_address,
      company_city: user.company_city,
      company_phone: user.company_phone,
      company_gsm: user.company_gsm, // Added GSM field
      company_email: user.company_email,
      company_website: user.company_website,
      company_logo: user.company_logo,
      company_tax_id: user.company_tax_id,
    };

    res.json({
      message: "Profile updated successfully",
      user: updatedUser,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// Export upload middleware
exports.upload = upload;
