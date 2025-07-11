const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const AdminModel = require("../models/AdminUser.model");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const sendMail = require("../utils/Nodemailer");

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRESIN = process.env.JWT_EXPIRESIN;

const generateNumericId = () => {
  return Math.floor(100000 + Math.random() * 900000);
};

const generateOTP = () => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

const RegiesterAdmin = async (req, res) => {
  try {
    const { name, password, phone, avatar, email } = req.body;

    const uniqueId = generateNumericId();
    const existing = await AdminModel.findOne({ email });

    if (existing) {
      return res.status(409).json(new ApiError(409, "Admin already exists"));
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newAdmin = await AdminModel.create({
      uniqueId,
      name,
      password: hashedPassword,
      phone,
      avatar,
      email,
    });

    return res
      .status(201)
      .json(
        new ApiResponse(201, { newAdmin }, "Admin registered successfully")
      );
  } catch (error) {
    console.error(error);
    return res.status(500).json(new ApiError(500, "Internal Server Error"));
  }
};

const AdminLogin = async (req, res) => {
  try {
    const { uniqueId, password } = req.body;

    const admin = await AdminModel.findOne({ uniqueId });
    if (!admin) {
      return res.status(404).json(new ApiError(404, "Admin not found"));
    }

    const isPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isPasswordValid) {
      return res.status(401).json(new ApiError(401, "Invalid credentials"));
    }

    const token = jwt.sign({ id: admin._id }, JWT_SECRET, {
      expiresIn: JWT_EXPIRESIN,
    });

    admin.lastLogin = new Date();
    await admin.save();

    return res
      .status(200)
      .json(new ApiResponse(200, { token, admin }, "Login successful"));
  } catch (error) {
    console.error(error);
    return res.status(500).json(new ApiError(500, "Internal Server Error"));
  }
};

const SendOtp = async (req, res) => {
  try {
    const { email } = req.params;

    const admin = await AdminModel.findOne({ email });
    if (!admin) {
      return res.status(404).json(new ApiError(404, "Admin not found"));
    }

    const otp = generateOTP();

    const htmlContent = `
      <h2>OTP for Password Reset</h2>
      <p>Hello ${admin.name},</p>
      <p>Your OTP to reset your password is:</p>
      <h3>${otp}</h3>
      <p>This OTP is valid for 10 minutes.</p>
    `;

    await sendMail(admin.email, "Your Password Reset OTP", htmlContent);

    return res.status(200).json(new ApiResponse(200, otp, "OTP sent to email"));
  } catch (error) {
    console.error(error);
    return res.status(500).json(new ApiError(500, "Internal Server Error"));
  }
};

const ForgotPassword = async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
      return res
        .status(400)
        .json(new ApiError(400, "Email and new password are required"));
    }

    const admin = await AdminModel.findOne({ email });
    if (!admin) {
      return res.status(404).json(new ApiError(404, "Admin not found"));
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    admin.password = hashedPassword;

    await admin.save();

    return res.status(200).json({
      success: true,
      message: "Password has been reset successfully",
    });
  } catch (error) {
    console.error("ForgotPassword Error:", error);
    return res.status(500).json(new ApiError(500, "Internal Server Error"));
  }
};

const UpdateProfile = async (req, res) => {
  try {
    const { email, name, phone, avatar, oldPassword, newPassword } = req.body;

    if (!email) {
      return res.status(400).json(new ApiError(400, "Email is required"));
    }

    const admin = await AdminModel.findOne({ email });
    if (!admin) {
      return res.status(404).json(new ApiError(404, "Admin not found"));
    }

    if (name) admin.name = name;
    if (phone) admin.phone = phone;
    if (avatar) admin.avatar = avatar;

    if (oldPassword && newPassword) {
      const isMatch = await bcrypt.compare(oldPassword, admin.password);
      if (!isMatch) {
        return res
          .status(401)
          .json(new ApiError(401, "Old password is incorrect"));
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      admin.password = hashedPassword;
    } else if (oldPassword || newPassword) {
      return res
        .status(400)
        .json(
          new ApiError(
            400,
            "Both old and new passwords are required to change password"
          )
        );
    }

    await admin.save();

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: admin,
    });
  } catch (error) {
    console.error("UpdateProfile Error:", error);
    return res.status(500).json(new ApiError(500, "Internal Server Error"));
  }
};

module.exports = {
  AdminLogin,
  RegiesterAdmin,
  SendOtp,
  ForgotPassword,
  UpdateProfile,
};
