/**
 * Inventory and Data Management System
 * Tech Stack: Node.js, Express.js, MongoDB (Mongoose), dotenv
 * Architecture: All-in-one minimal file architecture
 */

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');

// ============================================================================
// 1. APP CONFIGURATION & ENVIRONMENT SETUP
// ============================================================================
const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/inventory_db';

// Built-in Middleware for JSON & URL-encoded parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================================================
// 2. MONGOOSE SCHEMA & MODEL DEFINITION
// ============================================================================

/**
 * Calculates the product stock status based on current quantity and lowStockThreshold.
 * @param {number} quantity - Current product quantity
 * @param {number} threshold - Low stock threshold
 * @returns {'OUT_OF_STOCK' | 'LOW_STOCK' | 'IN_STOCK'}
 */
const calculateStockStatus = (quantity, threshold) => {
  if (quantity === 0) return 'OUT_OF_STOCK';
  if (quantity <= threshold) return 'LOW_STOCK';
  return 'IN_STOCK';
};

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      minlength: [2, 'Product name must be at least 2 characters long'],
      maxlength: [120, 'Product name cannot exceed 120 characters'],
    },
    sku: {
      type: String,
      required: [true, 'SKU (Stock Keeping Unit) is required'],
      unique: true,
      uppercase: true,
      trim: true,
      match: [
        /^[A-Za-z0-9_-]+$/,
        'SKU must only contain alphanumeric characters, underscores, or hyphens',
      ],
    },
    category: {
      type: String,
      required: [true, 'Product category is required'],
      trim: true,
      lowercase: true,
      minlength: [2, 'Category name must be at least 2 characters long'],
    },
    price: {
      type: Number,
      required: [true, 'Product price is required'],
      min: [0, 'Price cannot be negative'],
    },
    quantity: {
      type: Number,
      required: [true, 'Product quantity is required'],
      default: 0,
      min: [0, 'Quantity cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: '{VALUE} is not a valid integer quantity',
      },
    },
    lowStockThreshold: {
      type: Number,
      default: 10,
      min: [0, 'Low-stock threshold cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: '{VALUE} is not a valid integer threshold',
      },
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'Description cannot exceed 1000 characters'],
      default: '',
    },
    status: {
      type: String,
      enum: {
        values: ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'],
        message: '{VALUE} is not an allowed status',
      },
      default: 'OUT_OF_STOCK',
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Indexes for fast lookup, sorting, and reporting
productSchema.index({ category: 1 });
productSchema.index({ price: 1 });
productSchema.index({ quantity: 1 });
productSchema.index({ name: 'text', description: 'text' });

// Pre-save hook: automatically sync status based on stock level
productSchema.pre('save', function (next) {
  this.status = calculateStockStatus(this.quantity, this.lowStockThreshold);
  next();
});

const Product = mongoose.model('Product', productSchema);

// ============================================================================
// 3. VALIDATION MIDDLEWARE & HELPERS
// ============================================================================

/**
 * Validates MongoDB ObjectId in route parameters
 */
const validateObjectId = (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid ID',
      message: `The provided id '${id}' is not a valid MongoDB ObjectId.`,
    });
  }
  next();
};

// Async route handler wrapper to avoid repetitive try-catch blocks
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ============================================================================
// 4. API ROUTES
// ============================================================================

// ----------------------------------------------------------------------------
// ROOT / HEALTHCHECK / API OVERVIEW
// ----------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Welcome to the Inventory and Data Management System API',
    databaseStatus: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
    endpoints: {
      products: {
        createProduct: 'POST /api/products',
        getAllProducts: 'GET /api/products (supports ?search, ?category, ?minPrice, ?maxPrice, ?inStock, ?status, ?sortBy, ?sortOrder, ?page, ?limit)',
        getProductById: 'GET /api/products/:id',
        updateProduct: 'PUT /api/products/:id or PATCH /api/products/:id',
        adjustStock: 'POST /api/products/:id/stock or PATCH /api/products/:id/stock (payload: { action: "restock" | "sale", quantity: number })',
        deleteProduct: 'DELETE /api/products/:id',
      },
      reports: {
        lowStockAlert: 'GET /api/reports/low-stock (supports optional ?threshold=number)',
        categorySummary: 'GET /api/reports/category-summary (Aggregation pipeline report)',
      },
    },
  });
});

// ----------------------------------------------------------------------------
// CREATE PRODUCT API
// POST /api/products
// ----------------------------------------------------------------------------
app.post(
  '/api/products',
  asyncHandler(async (req, res) => {
    const { name, sku, category, price, quantity, lowStockThreshold, description } = req.body;

    const product = new Product({
      name,
      sku,
      category,
      price,
      quantity,
      lowStockThreshold,
      description,
    });

    const savedProduct = await product.save();

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: savedProduct,
    });
  })
);

// ----------------------------------------------------------------------------
// GET ALL PRODUCTS — FILTERING, SORTING & PAGINATION
// GET /api/products
// ----------------------------------------------------------------------------
app.get(
  '/api/products',
  asyncHandler(async (req, res) => {
    const {
      search,
      category,
      minPrice,
      maxPrice,
      inStock,
      status,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      limit = 10,
    } = req.query;

    // 1. Build Filter Criteria
    const query = {};

    // Search by Name or SKU
    if (search && search.trim() !== '') {
      const searchRegex = new RegExp(search.trim(), 'i');
      query.$or = [{ name: searchRegex }, { sku: searchRegex }, { description: searchRegex }];
    }

    // Filter by Category
    if (category && category.trim() !== '') {
      query.category = category.trim().toLowerCase();
    }

    // Filter by Price Range
    if (minPrice !== undefined || maxPrice !== undefined) {
      query.price = {};
      if (minPrice !== undefined && !isNaN(Number(minPrice))) {
        query.price.$gte = Number(minPrice);
      }
      if (maxPrice !== undefined && !isNaN(Number(maxPrice))) {
        query.price.$lte = Number(maxPrice);
      }
    }

    // Filter by In-Stock availability
    if (inStock !== undefined) {
      if (inStock === 'true' || inStock === true) {
        query.quantity = { $gt: 0 };
      } else if (inStock === 'false' || inStock === false) {
        query.quantity = { $eq: 0 };
      }
    }

    // Filter by Status ('IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK')
    if (status && ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'].includes(status.toUpperCase())) {
      query.status = status.toUpperCase();
    }

    // 2. Build Sorting Options
    const allowedSortFields = ['price', 'quantity', 'name', 'createdAt', 'updatedAt', 'sku'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const sortDirection = sortOrder.toLowerCase() === 'asc' ? 1 : -1;
    const sortOptions = { [sortField]: sortDirection };

    // 3. Build Pagination
    const pageNumber = Math.max(1, parseInt(page, 10) || 1);
    const limitNumber = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (pageNumber - 1) * limitNumber;

    // 4. Execute Queries in Parallel for optimal performance
    const [totalProducts, products] = await Promise.all([
      Product.countDocuments(query),
      Product.find(query).sort(sortOptions).skip(skip).limit(limitNumber).lean(),
    ]);

    const totalPages = Math.ceil(totalProducts / limitNumber) || 1;

    res.status(200).json({
      success: true,
      pagination: {
        totalItems: totalProducts,
        totalPages,
        currentPage: pageNumber,
        limit: limitNumber,
        hasNextPage: pageNumber < totalPages,
        hasPrevPage: pageNumber > 1,
      },
      filtersApplied: {
        search: search || null,
        category: category || null,
        minPrice: minPrice !== undefined ? Number(minPrice) : null,
        maxPrice: maxPrice !== undefined ? Number(maxPrice) : null,
        inStock: inStock !== undefined ? inStock === 'true' : null,
        status: status || null,
        sortBy: sortField,
        sortOrder: sortDirection === 1 ? 'asc' : 'desc',
      },
      data: products,
    });
  })
);

// ----------------------------------------------------------------------------
// GET SINGLE PRODUCT BY ID
// GET /api/products/:id
// ----------------------------------------------------------------------------
app.get(
  '/api/products/:id',
  validateObjectId,
  asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product Not Found',
        message: `No product found with id '${req.params.id}'`,
      });
    }

    res.status(200).json({
      success: true,
      data: product,
    });
  })
);

// ----------------------------------------------------------------------------
// UPDATE PRODUCT DETAILS
// PUT/PATCH /api/products/:id
// ----------------------------------------------------------------------------
const handleUpdateProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = { ...req.body };

  // Disallow direct tampering of internal timestamps or immutable fields if any
  delete updates._id;
  delete updates.createdAt;
  delete updates.updatedAt;

  // Retrieve current product first to handle status recalculation if quantity/threshold changes
  const existingProduct = await Product.findById(id);
  if (!existingProduct) {
    return res.status(404).json({
      success: false,
      error: 'Product Not Found',
      message: `No product found with id '${id}' to update`,
    });
  }

  // If quantity or lowStockThreshold is updated, recalculate status
  const newQuantity = updates.quantity !== undefined ? updates.quantity : existingProduct.quantity;
  const newThreshold =
    updates.lowStockThreshold !== undefined
      ? updates.lowStockThreshold
      : existingProduct.lowStockThreshold;

  updates.status = calculateStockStatus(newQuantity, newThreshold);

  const updatedProduct = await Product.findByIdAndUpdate(id, updates, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    success: true,
    message: 'Product updated successfully',
    data: updatedProduct,
  });
});

app.put('/api/products/:id', validateObjectId, handleUpdateProduct);
app.patch('/api/products/:id', validateObjectId, handleUpdateProduct);

// ----------------------------------------------------------------------------
// STOCK ADJUSTMENT (RESTOCK AND SALE OPERATIONS)
// POST/PATCH /api/products/:id/stock
// ----------------------------------------------------------------------------
const handleStockAdjustment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { action, quantity, notes } = req.body;

  // 1. Validate Input
  if (!action || !['restock', 'sale'].includes(action.toLowerCase())) {
    return res.status(400).json({
      success: false,
      error: 'Invalid Action',
      message: "The 'action' field is required and must be either 'restock' or 'sale'.",
    });
  }

  const stockAdjustmentQty = Number(quantity);
  if (!stockAdjustmentQty || !Number.isInteger(stockAdjustmentQty) || stockAdjustmentQty <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid Quantity',
      message: "The 'quantity' field must be a positive integer greater than 0.",
    });
  }

  const normalizedAction = action.toLowerCase();

  // 2. Perform Stock Operations Safely
  if (normalizedAction === 'sale') {
    // ATOMIC SAFE DECREMENT:
    // Ensures quantity is never decremented below 0 even under concurrent requests.
    const product = await Product.findOneAndUpdate(
      { _id: id, quantity: { $gte: stockAdjustmentQty } },
      { $inc: { quantity: -stockAdjustmentQty } },
      { new: true, runValidators: true }
    );

    // If query failed to match, distinguish between non-existent product vs insufficient stock
    if (!product) {
      const existingProduct = await Product.findById(id);
      if (!existingProduct) {
        return res.status(404).json({
          success: false,
          error: 'Product Not Found',
          message: `No product found with id '${id}'.`,
        });
      }

      return res.status(400).json({
        success: false,
        error: 'Insufficient Stock',
        message: `Cannot complete sale. Requested quantity is ${stockAdjustmentQty}, but only ${existingProduct.quantity} units are available.`,
        currentStock: existingProduct.quantity,
      });
    }

    // Update status to reflect new stock level
    product.status = calculateStockStatus(product.quantity, product.lowStockThreshold);
    await product.save();

    return res.status(200).json({
      success: true,
      message: `Sale processed successfully. Deducted ${stockAdjustmentQty} unit(s).`,
      action: 'sale',
      quantityDeducted: stockAdjustmentQty,
      notes: notes || null,
      data: product,
    });
  }

  if (normalizedAction === 'restock') {
    // ATOMIC SAFE INCREMENT:
    const product = await Product.findByIdAndUpdate(
      id,
      { $inc: { quantity: stockAdjustmentQty } },
      { new: true, runValidators: true }
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product Not Found',
        message: `No product found with id '${id}'.`,
      });
    }

    // Update status to reflect new stock level
    product.status = calculateStockStatus(product.quantity, product.lowStockThreshold);
    await product.save();

    return res.status(200).json({
      success: true,
      message: `Restock processed successfully. Added ${stockAdjustmentQty} unit(s).`,
      action: 'restock',
      quantityAdded: stockAdjustmentQty,
      notes: notes || null,
      data: product,
    });
  }
});

app.post('/api/products/:id/stock', validateObjectId, handleStockAdjustment);
app.patch('/api/products/:id/stock', validateObjectId, handleStockAdjustment);

// ----------------------------------------------------------------------------
// DELETE PRODUCT
// DELETE /api/products/:id
// ----------------------------------------------------------------------------
app.delete(
  '/api/products/:id',
  validateObjectId,
  asyncHandler(async (req, res) => {
    const deletedProduct = await Product.findByIdAndDelete(req.params.id);

    if (!deletedProduct) {
      return res.status(404).json({
        success: false,
        error: 'Product Not Found',
        message: `No product found with id '${req.params.id}' to delete`,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Product deleted successfully',
      data: deletedProduct,
    });
  })
);

// ----------------------------------------------------------------------------
// LOW-STOCK ALERT REPORT
// GET /api/reports/low-stock
// ----------------------------------------------------------------------------
app.get(
  '/api/reports/low-stock',
  asyncHandler(async (req, res) => {
    const { threshold } = req.query;

    let filterQuery;
    let thresholdMode;

    if (threshold !== undefined && !isNaN(Number(threshold))) {
      // User specified a custom threshold
      const customThreshold = Number(threshold);
      filterQuery = { quantity: { $lte: customThreshold } };
      thresholdMode = `Custom threshold <= ${customThreshold}`;
    } else {
      // Default: Compare each product's quantity to its own lowStockThreshold
      filterQuery = {
        $expr: { $lte: ['$quantity', '$lowStockThreshold'] },
      };
      thresholdMode = 'Per-product lowStockThreshold';
    }

    // Sort ascending by quantity so items that are completely out of stock appear first
    const lowStockProducts = await Product.find(filterQuery)
      .sort({ quantity: 1, name: 1 })
      .lean();

    res.status(200).json({
      success: true,
      reportName: 'Low-Stock Alert Report',
      generatedAt: new Date().toISOString(),
      thresholdMode,
      totalAlertCount: lowStockProducts.length,
      outOfStockCount: lowStockProducts.filter((p) => p.quantity === 0).length,
      data: lowStockProducts,
    });
  })
);

// ----------------------------------------------------------------------------
// CATEGORY-WISE INVENTORY SUMMARY (AGGREGATION PIPELINE)
// GET /api/reports/category-summary
// ----------------------------------------------------------------------------
app.get(
  '/api/reports/category-summary',
  asyncHandler(async (req, res) => {
    // MongoDB Aggregation Pipeline for category breakdown
    const categorySummary = await Product.aggregate([
      {
        $group: {
          _id: '$category',
          totalProducts: { $sum: 1 },
          totalStockQuantity: { $sum: '$quantity' },
          averagePrice: { $avg: '$price' },
          minPrice: { $min: '$price' },
          maxPrice: { $max: '$price' },
          totalInventoryValue: {
            $sum: { $multiply: ['$price', '$quantity'] },
          },
          outOfStockCount: {
            $sum: { $cond: [{ $eq: ['$quantity', 0] }, 1, 0] },
          },
          lowStockCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gt: ['$quantity', 0] },
                    { $lte: ['$quantity', '$lowStockThreshold'] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          inStockCount: {
            $sum: {
              $cond: [{ $gt: ['$quantity', '$lowStockThreshold'] }, 1, 0],
            },
          },
        },
      },
      {
        $project: {
          category: '$_id',
          _id: 0,
          totalProducts: 1,
          totalStockQuantity: 1,
          averagePrice: { $round: ['$averagePrice', 2] },
          minPrice: { $round: ['$minPrice', 2] },
          maxPrice: { $round: ['$maxPrice', 2] },
          totalInventoryValue: { $round: ['$totalInventoryValue', 2] },
          outOfStockCount: 1,
          lowStockCount: 1,
          inStockCount: 1,
        },
      },
      {
        $sort: { totalInventoryValue: -1 },
      },
    ]);

    // Calculate Grand Totals across all inventory
    const overallTotals = categorySummary.reduce(
      (acc, cat) => {
        acc.totalCategories += 1;
        acc.totalProducts += cat.totalProducts;
        acc.totalStockQuantity += cat.totalStockQuantity;
        acc.totalInventoryValue += cat.totalInventoryValue;
        acc.totalOutOfStock += cat.outOfStockCount;
        acc.totalLowStock += cat.lowStockCount;
        return acc;
      },
      {
        totalCategories: 0,
        totalProducts: 0,
        totalStockQuantity: 0,
        totalInventoryValue: 0,
        totalOutOfStock: 0,
        totalLowStock: 0,
      }
    );

    overallTotals.totalInventoryValue = Number(overallTotals.totalInventoryValue.toFixed(2));

    res.status(200).json({
      success: true,
      reportName: 'Category-wise Inventory Summary Report',
      generatedAt: new Date().toISOString(),
      overallTotals,
      categories: categorySummary,
    });
  })
);

// ============================================================================
// 5. CENTRALIZED ERROR HANDLING & 404 HANDLER
// ============================================================================

// Catch-all for undefined routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route Not Found',
    message: `Cannot ${req.method} ${req.originalUrl}. Please check the API documentation at GET /`,
  });
});

// Centralized Error Handling Middleware
app.use((err, req, res, next) => {
  // 1. Handle JSON syntax errors in request payload
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      error: 'Malformed JSON',
      message: 'The request body contains invalid JSON syntax.',
    });
  }

  // 2. Handle Mongoose Validation Errors
  if (err.name === 'ValidationError') {
    const validationErrors = {};
    for (const field in err.errors) {
      validationErrors[field] = err.errors[field].message;
    }
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: 'One or more fields failed validation.',
      details: validationErrors,
    });
  }

  // 3. Handle Mongoose CastError (e.g., invalid ObjectId or data type casting)
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      error: 'Invalid Data Format',
      message: `Invalid format for field '${err.path}': ${err.value}`,
    });
  }

  // 4. Handle MongoDB Duplicate Key Error (Code 11000)
  if (err.code === 11000) {
    const duplicateField = Object.keys(err.keyPattern || {})[0] || 'field';
    const duplicateValue = err.keyValue ? err.keyValue[duplicateField] : '';
    return res.status(409).json({
      success: false,
      error: 'Conflict / Duplicate Key',
      message: `A product with ${duplicateField} '${duplicateValue}' already exists. SKU must be unique.`,
      field: duplicateField,
    });
  }

  // 5. Default generic server error
  console.error('[Internal Server Error]:', err);
  res.status(err.status || 500).json({
    success: false,
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred.' : err.message,
  });
});

// ============================================================================
// 6. DATABASE CONNECTION & SERVER INITIALIZATION
// ============================================================================

const connectDB = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log(`[Database] MongoDB successfully connected to: ${MONGO_URI}`);
  } catch (error) {
    console.error(`[Database Error] Failed to connect to MongoDB: ${error.message}`);
    console.error('[Tip] Ensure MongoDB is running locally or specify a valid MONGO_URI in your .env file.');
  }
};

// Graceful Shutdown Handlers
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('\n[Process] MongoDB connection closed due to application termination.');
  process.exit(0);
});

// Start listening
const server = app.listen(PORT, async () => {
  console.log(`====================================================`);
  console.log(` Inventory and Data Management System`);
  console.log(` Server running on http://localhost:${PORT}`);
  console.log(` Documentation available at GET http://localhost:${PORT}/`);
  console.log(`====================================================`);
  await connectDB();
});

module.exports = { app, server, Product };
