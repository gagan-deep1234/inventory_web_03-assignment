# Inventory and Data Management System

A high-performance, robust RESTful backend built with **Node.js**, **Express.js**, and **MongoDB (Mongoose)** for managing a store or warehouse inventory catalogue.

This project was built following the strict constraint of **minimal files ("kam se kam files")**: the entire backend is encapsulated cleanly inside `server.js` with zero unnecessary boilerplate or external bloatware.

---

## 🚀 Features

- **Field-Level Schema Validation**: Mongoose schema enforcing rules on SKU format, positive prices, integer quantities, name lengths, and category constraints.
- **Automatic Stock Status**: Automatically manages product statuses (`IN_STOCK`, `LOW_STOCK`, `OUT_OF_STOCK`) based on current stock levels and custom thresholds.
- **Complete CRUD Operations**: Create, read, update details, adjust stock, and delete products.
- **Advanced Querying**: Search by name/SKU, filter by category, price range, stock availability, and status. Supports multi-field sorting and pagination.
- **Safe Stock Operations (Race-Condition Free)**: Restock and sale operations executed with atomic MongoDB updates (`$inc` and `$gte`) to prevent negative inventory even under high concurrency.
- **MongoDB Aggregation Pipeline**: Generates aggregated category-wise reports with metrics including total valuation, average price, min/max price, and stock levels.
- **Low-Stock Alert Report**: Identifies items nearing depletion.
- **Centralized Error Handling**: Unified responses for validation errors (400), invalid ObjectIds (400), duplicate SKUs (409), malformed JSON (400), and 404s.
- **Secure Environment Management**: Managed via `dotenv`.

---

## 📁 Project Structure (Minimal File Architecture)

```text
├── .env           # Environment variables (PORT, MONGO_URI)
├── package.json   # Project dependencies and startup scripts
├── server.js      # Complete application (Models, Routes, Middleware, Aggregations)
└── README.md      # Documentation & API testing guide
```

---

## 🛠️ Getting Started

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher)
- [MongoDB](https://www.mongodb.com/) (Local instance or MongoDB Atlas URI)

### 2. Environment Configuration
Inspect or edit the `.env` file in the root directory:
```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/inventory_db
```
*(Replace `MONGO_URI` with your MongoDB Atlas connection string if using a cloud database).*

### 3. Installation & Running
```bash
# Install dependencies (express, mongoose, dotenv)
npm install

# Start the server
npm start

# Or run in development mode with automatic reload
npm run dev
```
The server will start at: `http://localhost:5000`

---

## 📡 API Reference

### 1. Root / Health Check
- **`GET /`**
  - Returns API status, MongoDB connection status, and list of available endpoints.

---

### 2. Products Management (`/api/products`)

#### A. Create Product
- **Endpoint**: `POST /api/products`
- **Headers**: `Content-Type: application/json`
- **Body Example**:
  ```json
  {
    "name": "Mechanical Keyboard RGB",
    "sku": "KB-MEC-001",
    "category": "Electronics",
    "price": 89.99,
    "quantity": 25,
    "lowStockThreshold": 5,
    "description": "Hot-swappable mechanical gaming keyboard"
  }
  ```
- **Responses**:
  - `201 Created`: Returns created product document.
  - `400 Bad Request`: Field validation error (e.g., negative price, missing name).
  - `409 Conflict`: Duplicate SKU.

#### B. Get All Products (Search, Filter, Sort & Paginate)
- **Endpoint**: `GET /api/products`
- **Query Parameters**:
  - `search` (string): Searches keyword in `name`, `sku`, or `description`.
  - `category` (string): Filter by category (e.g., `electronics`).
  - `minPrice` & `maxPrice` (number): Price range filter.
  - `inStock` (boolean): `true` (quantity > 0) or `false` (quantity == 0).
  - `status` (string): `IN_STOCK`, `LOW_STOCK`, or `OUT_OF_STOCK`.
  - `sortBy` (string): Field to sort by (`price`, `quantity`, `name`, `createdAt`). Default: `createdAt`.
  - `sortOrder` (string): `asc` or `desc`. Default: `desc`.
  - `page` (number): Page number (default: `1`).
  - `limit` (number): Items per page (default: `10`, max `100`).
- **Example**:
  ```text
  GET /api/products?category=electronics&minPrice=50&maxPrice=200&sortBy=price&sortOrder=asc&page=1&limit=5
  ```

#### C. Get Single Product by ID
- **Endpoint**: `GET /api/products/:id`
- **Responses**:
  - `200 OK`: Product found.
  - `400 Bad Request`: Invalid MongoDB ObjectId format.
  - `404 Not Found`: Product with this ID does not exist.

#### D. Update Product Details
- **Endpoint**: `PUT /api/products/:id` or `PATCH /api/products/:id`
- **Body Example**:
  ```json
  {
    "price": 79.99,
    "description": "Updated model with silent red switches"
  }
  ```
- **Responses**:
  - `200 OK`: Returns updated product.
  - `400 Bad Request`: Validation failure.
  - `404 Not Found`: Product not found.

#### E. Safe Stock Adjustment (Restock & Sale Operations)
- **Endpoint**: `POST /api/products/:id/stock` or `PATCH /api/products/:id/stock`
- **Body Example (Sale)**:
  ```json
  {
    "action": "sale",
    "quantity": 3,
    "notes": "Order #1042"
  }
  ```
- **Body Example (Restock)**:
  ```json
  {
    "action": "restock",
    "quantity": 50,
    "notes": "Supplier batch shipment #B-88"
  }
  ```
- **Safety Features**:
  - Uses atomic `$inc` with `{ quantity: { $gte: quantity } }` condition for sales.
  - Prevents race conditions and stops stock from becoming negative.
  - Automatically updates `status` (`IN_STOCK` / `LOW_STOCK` / `OUT_OF_STOCK`).

#### F. Delete Product
- **Endpoint**: `DELETE /api/products/:id`
- **Responses**:
  - `200 OK`: Product deleted.
  - `404 Not Found`: Product not found.

---

### 3. Reports (`/api/reports`)

#### A. Low-Stock Alert Report
- **Endpoint**: `GET /api/reports/low-stock`
- **Optional Query**: `?threshold=15` (overrides individual product thresholds).
- **Description**: Returns all items where current stock is less than or equal to their threshold, sorted ascending by quantity (items with 0 stock appear first).

#### B. Category-wise Inventory Summary (Aggregation Pipeline)
- **Endpoint**: `GET /api/reports/category-summary`
- **Description**: Uses a multi-stage MongoDB aggregation pipeline (`$group`, `$project`, `$sort`) to compute:
  - `totalProducts`: Number of products in category.
  - `totalStockQuantity`: Sum of all units.
  - `averagePrice`: Average item price (rounded to 2 decimal places).
  - `minPrice` & `maxPrice`: Price range within the category.
  - `totalInventoryValue`: Total asset valuation (`price * quantity`).
  - `outOfStockCount` & `lowStockCount`: Number of affected products.
  - **`overallTotals`**: Warehouse-wide rollup of total categories, stock units, and combined inventory value.

---

## 🧪 Testing with cURL

### 1. Create a Product
```bash
curl -X POST http://localhost:5000/api/products \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Wireless Mouse\",\"sku\":\"MOU-WIR-001\",\"category\":\"Electronics\",\"price\":29.99,\"quantity\":15,\"lowStockThreshold\":5}"
```

### 2. Retrieve All Products with Filter & Sort
```bash
curl "http://localhost:5000/api/products?category=electronics&sortBy=price&sortOrder=asc"
```

### 3. Record a Sale (Atomic Stock Decrement)
```bash
curl -X POST http://localhost:5000/api/products/<PRODUCT_ID>/stock \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"sale\",\"quantity\":2}"
```

### 4. Restock Product
```bash
curl -X POST http://localhost:5000/api/products/<PRODUCT_ID>/stock \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"restock\",\"quantity\":10}"
```

### 5. View Category Inventory Report
```bash
curl http://localhost:5000/api/reports/category-summary
```

### 6. View Low-Stock Alerts
```bash
curl http://localhost:5000/api/reports/low-stock
```
# inventory_web_03-assignment
