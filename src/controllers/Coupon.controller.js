const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const CouponModel = require("../models/Coupon.model");
const CategoryModel = require("../models/Category.model");
const CartModel = require("../models/Cart.model");

const getAllCoupons = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      isActive,
      discountType,
      sortBy = "createdAt",
      sortOrder = "desc",
      expired,
      category,
      subCategory,
      productCategory,
    } = req.query;

    const query = {};
    if (isActive !== undefined) {
      if (!["true", "false"].includes(isActive)) {
        return res
          .status(400)
          .json(new ApiError(400, "isActive must be 'true' or 'false'"));
      }
      query.isActive = isActive === "true";
    }

    if (discountType) {
      if (!["percentage", "fixed"].includes(discountType)) {
        return res
          .status(400)
          .json(
            new ApiError(400, "discountType must be 'percentage' or 'fixed'")
          );
      }
      query.discountType = discountType;
    }

    if (expired === "true") {
      query.expiresAt = { $lt: new Date() };
    } else if (expired === "false") {
      query.$or = [{ expiresAt: { $gte: new Date() } }, { expiresAt: null }];
    }
    if (category) {
      query.category = { $in: Array.isArray(category) ? category : [category] };
    }
    if (subCategory) {
      query.subCategory = {
        $in: Array.isArray(subCategory) ? subCategory : [subCategory],
      };
    }
    if (productCategory) {
      query.ProductCategory = {
        $in: Array.isArray(productCategory)
          ? productCategory
          : [productCategory],
      };
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (isNaN(pageNum) || pageNum < 1) {
      return res
        .status(400)
        .json(new ApiError(400, "Page number must be a positive integer"));
    }

    if (isNaN(limitNum) || limitNum < 1 || limitNum > 50) {
      return res
        .status(400)
        .json(
          new ApiError(400, "Limit must be a positive integer not exceeding 50")
        );
    }

    const validSortFields = [
      "createdAt",
      "discountValue",
      "expiresAt",
      "code",
      "name",
    ];
    const sortField = validSortFields.includes(sortBy) ? sortBy : "createdAt";
    const sortDirection = sortOrder.toLowerCase() === "asc" ? 1 : -1;

    const [coupons, totalCount] = await Promise.all([
      CouponModel.find(query)
        .select(
          "name code discountType discountValue minOrderAmount startAt expiresAt usageLimit usedCount image termsAndConditions description isActive category subCategory ProductCategory"
        )
        .sort({ [sortField]: sortDirection })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      CouponModel.countDocuments(query),
    ]);

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          coupons,
          pagination: {
            currentPage: pageNum,
            totalPages: Math.ceil(totalCount / limitNum) || 1,
            totalItems: totalCount,
            limit: limitNum,
            hasNextPage: pageNum < Math.ceil(totalCount / limitNum),
            hasPreviousPage: pageNum > 1,
          },
        },
        "Coupons fetched successfully"
      )
    );
  } catch (error) {
    console.error("Error in getAllCoupons:", error);
    return res.status(500).json(new ApiError(500, "Internal server error"));
  }
};

const ValidateCoupon = async (req, res) => {
  try {
    const {
      code,
      orderTotal,
      date,
      userId,
      category,
      subCategory,
      ProductCategory,
    } = req.query;

    if (!code || !orderTotal || !userId) {
      return res
        .status(400)
        .json(
          new ApiError(400, "Coupon code, order total, and userId are required")
        );
    }

    const orderAmount = parseFloat(orderTotal);
    if (isNaN(orderAmount) || orderAmount <= 0) {
      return res
        .status(400)
        .json(new ApiError(400, "Order total must be a positive number"));
    }

    let validationDate = new Date();
    if (date) {
      const datePattern = /^(\d{2})-(\d{2})-(\d{4})$/;
      if (!datePattern.test(date)) {
        return res
          .status(400)
          .json(new ApiError(400, "Invalid date format. Use DD-MM-YYYY"));
      }
      const [day, month, year] = date.split("-").map(Number);
      validationDate = new Date(year, month - 1, day);
      if (
        isNaN(validationDate.getTime()) ||
        validationDate.getFullYear() !== year
      ) {
        return res.status(400).json(new ApiError(400, "Invalid date values."));
      }
    }

    const trimmedCode = code.trim().toUpperCase();

    const coupon = await CouponModel.findOne({
      code: trimmedCode,
      isActive: true,
      $or: [
        { startAt: { $exists: false } },
        { startAt: { $lte: validationDate } },
      ],
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gte: validationDate } },
      ],
      $expr: { $lt: ["$usedCount", "$usageLimit"] },
    });

    if (!coupon) {
      return res
        .status(404)
        .json(
          new ApiError(
            404,
            "Coupon not found, inactive, or usage limit reached"
          )
        );
    }

    if (coupon.usedBy.includes(userId)) {
      return res
        .status(400)
        .json(new ApiError(400, "You have already used this coupon"));
    }

    const inputCategories = {
      category: category?.split(",").map((c) => c.trim()) || [],
      subCategory: subCategory?.split(",").map((c) => c.trim()) || [],
      ProductCategory: ProductCategory?.split(",").map((c) => c.trim()) || [],
    };

    const hasCategoryRestriction =
      coupon.category?.length ||
      coupon.subCategory?.length ||
      coupon.ProductCategory?.length;

    if (hasCategoryRestriction) {
      let matched = false;
      const couponCategoryNames = coupon.category?.map((cat) => cat) || [];
      const fullCategories = await CategoryModel.find({
        $or: [{ name: { $in: couponCategoryNames } }],
        isActive: true,
      }).lean();

      for (const cat of fullCategories) {
        if (
          inputCategories.category.includes(String(cat._id)) ||
          inputCategories.category.includes(cat.name)
        ) {
          matched = true;
          break;
        }

        const subCatIds = cat.subCategories?.map((sc) => String(sc._id)) || [];
        const subCatNames = cat.subCategories?.map((sc) => sc.name) || [];
        if (
          subCatIds.some((id) => inputCategories.subCategory.includes(id)) ||
          subCatNames.some((name) => inputCategories.subCategory.includes(name))
        ) {
          matched = true;
          break;
        }

        const subSubCatIds =
          cat.subCategories?.flatMap(
            (sc) => sc.subSubCategories?.map((ssc) => String(ssc._id)) || []
          ) || [];
        const subSubCatNames =
          cat.subCategories?.flatMap(
            (sc) => sc.subSubCategories?.map((ssc) => ssc.name) || []
          ) || [];
        if (
          subSubCatIds.some((id) =>
            inputCategories.ProductCategory.includes(id)
          ) ||
          subSubCatNames.some((name) =>
            inputCategories.ProductCategory.includes(name)
          )
        ) {
          matched = true;
          break;
        }
      }

      if (!matched) {
        return res
          .status(400)
          .json(
            new ApiError(400, "Coupon not applicable to selected categories")
          );
      }
    }

    if (coupon.minOrderAmount && orderAmount < coupon.minOrderAmount) {
      return res
        .status(400)
        .json(
          new ApiError(
            400,
            `Order total must be at least ${coupon.minOrderAmount}`
          )
        );
    }

    let discount = 0;
    if (coupon.discountType === "percentage") {
      discount = (coupon.discountValue / 100) * orderAmount;
      discount = Math.min(discount, orderAmount);
    } else if (coupon.discountType === "fixed") {
      discount = Math.min(coupon.discountValue, orderAmount);
    }

    discount = Math.round(discount * 100) / 100;

    await CouponModel.updateOne(
      { _id: coupon._id },
      {
        $addToSet: { usedBy: userId },
        $inc: { usedCount: 1 },
      }
    );

    const cart = await CartModel.findOne({ user: userId });
    if (cart) {
      cart.discount = discount;
      cart.discountType = coupon.discountType;
      cart.couponCode = coupon.code;
      cart.discountValue = coupon.discountValue;
      await cart.save();
    }

    let formattedExpiresAt = null;
    if (coupon.expiresAt) {
      const expiresDate = new Date(coupon.expiresAt);
      formattedExpiresAt = expiresDate.toLocaleDateString("en-GB");
    }

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          valid: true,
          code: coupon.code,
          discount,
          discountType: coupon.discountType,
          discountValue: coupon.discountValue,
          minOrderAmount: coupon.minOrderAmount || 0,
          expiresAt: formattedExpiresAt,
          usageLimit: coupon.usageLimit,
          usedCount: coupon.usedCount + 1,
        },
        "Coupon validated successfully"
      )
    );
  } catch (error) {
    console.error("Coupon validation error:", error);
    return res.status(500).json(new ApiError(500, "Internal Server Error"));
  }
};

const CreateCoupons = async (req, res) => {
  try {
    const {
      code,
      discountType,
      discountValue,
      minOrderAmount,
      startAt,
      expiresAt,
      usageLimit,
      image,
      isActive,
      termsAndConditions,
      description,
      category,
      subCategory,
      ProductCategory,
    } = req.body;

    if (!code || !discountType || !discountValue) {
      return res
        .status(400)
        .json(
          new ApiError(
            400,
            "Code, discountType, and discountValue are required"
          )
        );
    }

    const validateStringArray = (arr, fieldName) => {
      if (arr !== undefined) {
        if (!Array.isArray(arr)) {
          throw new ApiError(400, `${fieldName} must be an array of strings`);
        }
        const isValid = arr.every(
          (item) => typeof item === "string" && item.trim() !== ""
        );
        if (!isValid) {
          throw new ApiError(
            400,
            `Each ${fieldName} must be a non-empty string`
          );
        }
        return arr.map((item) => item.trim());
      }
      return [];
    };

    const parsedCategory = validateStringArray(category, "category");
    const parsedSubCategory = validateStringArray(subCategory, "subCategory");
    const parsedProductCategory = validateStringArray(
      ProductCategory,
      "ProductCategory"
    );

    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedCode || trimmedCode.length < 3 || trimmedCode.length > 20) {
      return res
        .status(400)
        .json(new ApiError(400, "Code must be between 3 and 20 characters"));
    }

    if (!["percentage", "fixed"].includes(discountType)) {
      return res
        .status(400)
        .json(
          new ApiError(400, "discountType must be 'percentage' or 'fixed'")
        );
    }

    const parsedDiscountValue = parseFloat(discountValue);
    if (isNaN(parsedDiscountValue) || parsedDiscountValue <= 0) {
      return res
        .status(400)
        .json(new ApiError(400, "Discount value must be a positive number"));
    }
    if (discountType === "percentage" && parsedDiscountValue > 100) {
      return res
        .status(400)
        .json(new ApiError(400, "Percentage discount cannot exceed 100"));
    }

    let parsedMinOrderAmount = 0;
    if (minOrderAmount !== undefined) {
      parsedMinOrderAmount = parseFloat(minOrderAmount);
      if (isNaN(parsedMinOrderAmount) || parsedMinOrderAmount < 0) {
        return res
          .status(400)
          .json(new ApiError(400, "Minimum order amount cannot be negative"));
      }
    }

    let parsedStartAt = undefined;
    if (startAt) {
      parsedStartAt = new Date(startAt);
      if (isNaN(parsedStartAt.getTime())) {
        return res
          .status(400)
          .json(
            new ApiError(400, "Invalid startAt date format. Use ISO format.")
          );
      }
    }

    let parsedExpiresAt = undefined;
    if (expiresAt) {
      parsedExpiresAt = new Date(expiresAt);
      if (isNaN(parsedExpiresAt.getTime())) {
        return res
          .status(400)
          .json(
            new ApiError(400, "Invalid expiresAt date format. Use ISO format.")
          );
      }
      if (parsedStartAt && parsedExpiresAt <= parsedStartAt) {
        return res
          .status(400)
          .json(new ApiError(400, "expiresAt must be after startAt"));
      }
    }

    let parsedUsageLimit = 1;
    if (usageLimit !== undefined) {
      parsedUsageLimit = parseInt(usageLimit);
      if (isNaN(parsedUsageLimit) || parsedUsageLimit <= 0) {
        return res
          .status(400)
          .json(new ApiError(400, "Usage limit must be a positive integer"));
      }
    }

    if (image && typeof image !== "string") {
      return res
        .status(400)
        .json(new ApiError(400, "Image must be a valid string URL"));
    }

    const parsedIsActive = isActive !== undefined ? Boolean(isActive) : true;

    const existingCoupon = await CouponModel.findOne({ code: trimmedCode });
    if (existingCoupon) {
      return res
        .status(400)
        .json(new ApiError(400, "Coupon code already exists"));
    }

    const coupon = new CouponModel({
      code: trimmedCode,
      discountType,
      discountValue: parsedDiscountValue,
      minOrderAmount: parsedMinOrderAmount,
      startAt: parsedStartAt,
      expiresAt: parsedExpiresAt,
      usageLimit: parsedUsageLimit,
      usedCount: 0,
      usedBy: [],
      image,
      isActive: parsedIsActive,
      termsAndConditions,
      description,
      category: parsedCategory,
      subCategory: parsedSubCategory,
      ProductCategory: parsedProductCategory,
    });

    await coupon.save();

    return res
      .status(200)
      .json(new ApiResponse(200, coupon, "Coupon created successfully"));
  } catch (error) {
    console.error("Create coupon error:", error);
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    return res
      .status(statusCode)
      .json(new ApiError(statusCode, error.message || "Internal Server Error"));
  }
};

const EditCoupons = async (req, res) => {
  try {
    const {
      couponId,
      code,
      discountType,
      discountValue,
      minOrderAmount,
      startAt,
      expiresAt,
      usageLimit,
      image,
      isActive,
      termsAndConditions,
      description,
    } = req.body;

    if (!couponId) {
      return res.status(400).json(new ApiError(400, "Coupon ID is required"));
    }

    const coupon = await CouponModel.findById(couponId);
    if (!coupon) {
      return res.status(404).json(new ApiError(404, "Coupon not found"));
    }

    const updateData = {};

    if (code) {
      const trimmedCode = code.trim().toUpperCase();
      if (trimmedCode.length < 3 || trimmedCode.length > 20) {
        return res
          .status(400)
          .json(new ApiError(400, "Code must be between 3 and 20 characters"));
      }

      if (trimmedCode !== coupon.code) {
        const existingCoupon = await CouponModel.findOne({ code: trimmedCode });
        if (existingCoupon) {
          return res
            .status(400)
            .json(new ApiError(400, "Coupon code already exists"));
        }
        updateData.code = trimmedCode;
      }
    }

    if (discountType) {
      if (!["percentage", "fixed"].includes(discountType)) {
        return res
          .status(400)
          .json(
            new ApiError(400, "discountType must be 'percentage' or 'fixed'")
          );
      }
      updateData.discountType = discountType;
    }

    if (discountValue !== undefined) {
      const parsedDiscountValue = parseFloat(discountValue);
      if (isNaN(parsedDiscountValue) || parsedDiscountValue <= 0) {
        return res
          .status(400)
          .json(new ApiError(400, "Discount value must be a positive number"));
      }
      if (
        (discountType || coupon.discountType) === "percentage" &&
        parsedDiscountValue > 100
      ) {
        return res
          .status(400)
          .json(new ApiError(400, "Percentage discount cannot exceed 100"));
      }
      updateData.discountValue = parsedDiscountValue;
    }

    if (minOrderAmount !== undefined) {
      const parsedMinOrderAmount = parseFloat(minOrderAmount);
      if (isNaN(parsedMinOrderAmount) || parsedMinOrderAmount < 0) {
        return res
          .status(400)
          .json(new ApiError(400, "Minimum order amount cannot be negative"));
      }
      updateData.minOrderAmount = parsedMinOrderAmount;
    }

    if (startAt !== undefined) {
      if (startAt === null) {
        updateData.startAt = null;
      } else {
        const parsedStartAt = new Date(startAt);
        if (isNaN(parsedStartAt.getTime())) {
          return res
            .status(400)
            .json(
              new ApiError(
                400,
                "Invalid startAt date format. Use ISO 8601 format"
              )
            );
        }
        updateData.startAt = parsedStartAt;
      }
    }

    if (expiresAt !== undefined) {
      if (expiresAt === null) {
        updateData.expiresAt = null;
      } else {
        const parsedExpiresAt = new Date(expiresAt);
        if (isNaN(parsedExpiresAt.getTime())) {
          return res
            .status(400)
            .json(
              new ApiError(
                400,
                "Invalid expiresAt date format. Use ISO 8601 format"
              )
            );
        }
        if (updateData.startAt && parsedExpiresAt <= updateData.startAt) {
          return res
            .status(400)
            .json(new ApiError(400, "expiresAt must be after startAt"));
        }
        updateData.expiresAt = parsedExpiresAt;
      }
    }

    if (usageLimit !== undefined) {
      const parsedUsageLimit = parseInt(usageLimit);
      if (isNaN(parsedUsageLimit) || parsedUsageLimit <= 0) {
        return res
          .status(400)
          .json(new ApiError(400, "Usage limit must be a positive integer"));
      }
      if (parsedUsageLimit < coupon.usedCount) {
        return res
          .status(400)
          .json(
            new ApiError(
              400,
              "Usage limit cannot be less than current used count"
            )
          );
      }
      updateData.usageLimit = parsedUsageLimit;
    }

    if (image !== undefined) {
      if (image !== null && typeof image !== "string") {
        return res
          .status(400)
          .json(new ApiError(400, "Image must be a valid string URL or null"));
      }
      updateData.image = image;
    }

    if (isActive !== undefined) {
      updateData.isActive = Boolean(isActive);
    }

    if (termsAndConditions !== undefined) {
      if (termsAndConditions !== null) {
        const trimmedTerms = termsAndConditions.trim().replace(/[<>&"]/g, "");
        if (trimmedTerms.length > 1000) {
          return res
            .status(400)
            .json(
              new ApiError(
                400,
                "Terms and conditions cannot exceed 1000 characters"
              )
            );
        }
        updateData.termsAndConditions = trimmedTerms;
      } else {
        updateData.termsAndConditions = null;
      }
    }

    if (description !== undefined) {
      if (description !== null) {
        const trimmedDescription = description.trim().replace(/[<>&"]/g, "");
        if (trimmedDescription.length > 500) {
          return res
            .status(400)
            .json(
              new ApiError(400, "Description cannot exceed 500 characters")
            );
        }
        updateData.description = trimmedDescription;
      } else {
        updateData.description = null;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return res
        .status(400)
        .json(new ApiError(400, "No valid fields provided for update"));
    }

    const updatedCoupon = await CouponModel.findByIdAndUpdate(
      couponId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).lean();

    if (!updatedCoupon) {
      return res.status(404).json(new ApiError(404, "Coupon not found"));
    }

    return res
      .status(200)
      .json(new ApiResponse(200, updatedCoupon, "Coupon updated successfully"));
  } catch (error) {
    console.error("Edit coupon error:", error);
    return res.status(500).json(new ApiError(500, "Internal Server Error"));
  }
};

const DeleteCoupons = async (req, res) => {
  try {
    const { couponId } = req.body;

    if (!couponId) {
      return res.status(400).json(new ApiError(400, "Coupon ID is required"));
    }

    if (!couponId) {
      return res
        .status(400)
        .json(new ApiError(400, "Invalid Coupon ID format"));
    }

    const deletedCoupon = await CouponModel.findByIdAndDelete(couponId);

    if (!deletedCoupon) {
      return res.status(404).json(new ApiError(404, "Coupon not found"));
    }

    return res
      .status(200)
      .json(new ApiResponse(200, null, "Coupon deleted successfully"));
  } catch (error) {
    console.error("Delete coupon error:", error);
    return res.status(500).json(new ApiError(500, "Internal Server Error"));
  }
};

module.exports = {
  getAllCoupons,
  CreateCoupons,
  EditCoupons,
  ValidateCoupon,
  DeleteCoupons,
};
