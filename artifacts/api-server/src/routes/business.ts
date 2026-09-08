import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  CreateExpenseBody,
  CreateExpenseResponse,
  CreateProductBody,
  CreateProductResponse,
  CreatePurchaseBody,
  CreatePurchaseResponse,
  CreateSaleBody,
  CreateSaleResponse,
  DashboardSummary,
  DeleteProductParams,
  GetDashboardSummaryResponse,
  GetRecentActivityQueryParams,
  GetRecentActivityResponse,
  ListExpensesQueryParams,
  ListExpensesResponse,
  ListProductsResponse,
  ListPurchasesQueryParams,
  ListPurchasesResponse,
  ListSalesQueryParams,
  ListSalesResponse,
  UpdateProductBody,
  UpdateProductParams,
  UpdateProductResponse,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import {
  expensesTable,
  productsTable,
  purchasesTable,
  salesTable,
} from "@workspace/db";

const router: IRouter = Router();
type Row = Record<string, unknown>;

const numberValue = (value: unknown) => Number(value ?? 0);
const dateValue = (value: unknown) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "");
const resultRows = (result: unknown): Row[] => {
  if (Array.isArray(result)) return result as Row[];
  if (
    result &&
    typeof result === "object" &&
    "rows" in result &&
    Array.isArray((result as { rows?: unknown[] }).rows)
  ) {
    return (result as { rows: Row[] }).rows;
  }
  return [];
};

const productSelect = sql`
  SELECT
    p.id,
    p.name,
    p.unit,
    p.min_stock AS "minStock",
    COALESCE((SELECT SUM(quantity) FROM business_purchases WHERE product_id = p.id), 0) AS "purchasedQty",
    COALESCE((SELECT SUM(quantity) FROM business_sales WHERE product_id = p.id), 0) AS "soldQty",
    COALESCE((SELECT SUM(quantity) FROM business_purchases WHERE product_id = p.id), 0)
      - COALESCE((SELECT SUM(quantity) FROM business_sales WHERE product_id = p.id), 0) AS "stockQty",
    COALESCE(
      (SELECT SUM(total_cost) / NULLIF(SUM(quantity), 0) FROM business_purchases WHERE product_id = p.id),
      0
    ) AS "averageCost"
  FROM business_products p
`;

async function getProductRows(id?: number) {
  const rows = await db.execute(
    id ? sql`${productSelect} WHERE p.id = ${id}` : sql`${productSelect} ORDER BY p.name`,
  );
  return resultRows(rows);
}

function toProduct(row: Row) {
  const stockQty = numberValue(row.stockQty);
  const averageCost = numberValue(row.averageCost);
  const minStock = numberValue(row.minStock);
  return ListProductsResponse.element.parse({
    id: Number(row.id),
    name: String(row.name),
    unit: String(row.unit),
    minStock,
    purchasedQty: numberValue(row.purchasedQty),
    soldQty: numberValue(row.soldQty),
    stockQty,
    averageCost,
    stockValue: stockQty * averageCost,
    lowStock: stockQty <= minStock,
  });
}

async function getProduct(id: number) {
  const rows = await getProductRows(id);
  return rows[0] ? toProduct(rows[0]) : undefined;
}

router.get("/summary", async (_req, res, next) => {
  try {
    const rows = await db.execute(sql`
      SELECT
        COALESCE((SELECT SUM(total_amount) FROM business_sales), 0) AS "totalSales",
        COALESCE((SELECT SUM(total_cost) FROM business_purchases), 0) AS "totalPurchases",
        COALESCE((SELECT SUM(profit) FROM business_sales), 0) AS "grossProfit",
        COALESCE((SELECT SUM(amount) FROM business_expenses), 0) AS "totalExpenses",
        COALESCE((SELECT SUM(due_amount) FROM business_sales), 0) AS "totalReceivable",
        COALESCE((SELECT SUM(stock_value) FROM (
          SELECT
            (COALESCE((SELECT SUM(quantity) FROM business_purchases bp WHERE bp.product_id = p.id), 0)
             - COALESCE((SELECT SUM(quantity) FROM business_sales bs WHERE bs.product_id = p.id), 0))
            * COALESCE((SELECT SUM(total_cost) / NULLIF(SUM(quantity), 0) FROM business_purchases bc WHERE bc.product_id = p.id), 0)
            AS stock_value
          FROM business_products p
        ) stock_values), 0) AS "stockValue",
        (SELECT COUNT(*) FROM business_products) AS "productCount",
        (SELECT COUNT(*) FROM (
          SELECT p.id
          FROM business_products p
          WHERE (
            COALESCE((SELECT SUM(quantity) FROM business_purchases bp WHERE bp.product_id = p.id), 0)
            - COALESCE((SELECT SUM(quantity) FROM business_sales bs WHERE bs.product_id = p.id), 0)
          ) <= p.min_stock
        ) low_stock) AS "lowStockCount"
    `);
    const row = resultRows(rows)[0] ?? {};
    res.json(
      GetDashboardSummaryResponse.parse({
        totalSales: numberValue(row.totalSales),
        totalPurchases: numberValue(row.totalPurchases),
        grossProfit: numberValue(row.grossProfit),
        totalExpenses: numberValue(row.totalExpenses),
        totalReceivable: numberValue(row.totalReceivable),
        stockValue: numberValue(row.stockValue),
        productCount: Number(row.productCount ?? 0),
        lowStockCount: Number(row.lowStockCount ?? 0),
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/activity", async (req, res, next) => {
  try {
    const { limit = 20 } = GetRecentActivityQueryParams.parse(req.query);
    const rows = await db.execute(sql`
      SELECT 'sale-' || id::text AS id, 'sale' AS type, customer AS title, total_amount AS amount, date::text AS date
      FROM business_sales
      UNION ALL
      SELECT 'purchase-' || id::text AS id, 'purchase' AS type, supplier AS title, total_cost AS amount, date::text AS date
      FROM business_purchases
      UNION ALL
      SELECT 'expense-' || id::text AS id, 'expense' AS type, description AS title, amount, date::text AS date
      FROM business_expenses
      ORDER BY date DESC
      LIMIT ${limit}
    `);
    res.json(
      GetRecentActivityResponse.parse(
        resultRows(rows).map((row) => ({
          id: String(row.id),
          type: row.type,
          title: String(row.title),
          amount: numberValue(row.amount),
          date: new Date(`${String(row.date)}T00:00:00.000Z`).toISOString(),
        })),
      ),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/products", async (_req, res, next) => {
  try {
    res.json(ListProductsResponse.parse((await getProductRows()).map(toProduct)));
  } catch (error) {
    next(error);
  }
});

router.post("/products", async (req, res, next) => {
  try {
    const body = CreateProductBody.parse(req.body);
    const [created] = await db
      .insert(productsTable)
      .values({
        name: body.name,
        unit: body.unit,
        minStock: String(body.minStock),
      })
      .returning({ id: productsTable.id });
    const product = await getProduct(created.id);
    res.status(201).json(CreateProductResponse.parse(product));
  } catch (error) {
    next(error);
  }
});

router.patch("/products/:id", async (req, res, next) => {
  try {
    const params = UpdateProductParams.parse(req.params);
    const body = UpdateProductBody.parse(req.body);
    await db
      .update(productsTable)
      .set({
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.unit === undefined ? {} : { unit: body.unit }),
        ...(body.minStock === undefined ? {} : { minStock: String(body.minStock) }),
      })
      .where(eq(productsTable.id, params.id));
    const product = await getProduct(params.id);
    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    res.json(UpdateProductResponse.parse(product));
  } catch (error) {
    next(error);
  }
});

router.delete("/products/:id", async (req, res, next) => {
  try {
    const params = DeleteProductParams.parse(req.params);
    await db.delete(productsTable).where(eq(productsTable.id, params.id));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/purchases", async (req, res, next) => {
  try {
    const { limit = 20 } = ListPurchasesQueryParams.parse(req.query);
    const rows = await db
      .select({
        id: purchasesTable.id,
        date: purchasesTable.date,
        supplier: purchasesTable.supplier,
        productId: purchasesTable.productId,
        productName: productsTable.name,
        quantity: purchasesTable.quantity,
        unitCost: purchasesTable.unitCost,
        transportCost: purchasesTable.transportCost,
        otherCost: purchasesTable.otherCost,
        totalCost: purchasesTable.totalCost,
      })
      .from(purchasesTable)
      .innerJoin(productsTable, eq(productsTable.id, purchasesTable.productId))
      .orderBy(desc(purchasesTable.date), desc(purchasesTable.id))
      .limit(limit);
    res.json(
      ListPurchasesResponse.parse(
        rows.map((row) => ({
          ...row,
          date: dateValue(row.date),
          quantity: numberValue(row.quantity),
          unitCost: numberValue(row.unitCost),
          transportCost: numberValue(row.transportCost),
          otherCost: numberValue(row.otherCost),
          totalCost: numberValue(row.totalCost),
        })),
      ),
    );
  } catch (error) {
    next(error);
  }
});

router.post("/purchases", async (req, res, next) => {
  try {
    const body = CreatePurchaseBody.parse(req.body);
    const totalCost =
      body.quantity * body.unitCost + (body.transportCost ?? 0) + (body.otherCost ?? 0);
    const [created] = await db
      .insert(purchasesTable)
      .values({
        date: String(body.date),
        supplier: body.supplier,
        productId: body.productId,
        quantity: String(body.quantity),
        unitCost: String(body.unitCost),
        transportCost: String(body.transportCost ?? 0),
        otherCost: String(body.otherCost ?? 0),
        totalCost: String(totalCost),
      })
      .returning({ id: purchasesTable.id });
    const row = await db
      .select({
        id: purchasesTable.id,
        date: purchasesTable.date,
        supplier: purchasesTable.supplier,
        productId: purchasesTable.productId,
        productName: productsTable.name,
        quantity: purchasesTable.quantity,
        unitCost: purchasesTable.unitCost,
        transportCost: purchasesTable.transportCost,
        otherCost: purchasesTable.otherCost,
        totalCost: purchasesTable.totalCost,
      })
      .from(purchasesTable)
      .innerJoin(productsTable, eq(productsTable.id, purchasesTable.productId))
      .where(eq(purchasesTable.id, created.id));
    const purchase = row[0];
    res.status(201).json(
      CreatePurchaseResponse.parse({
        ...purchase,
        date: dateValue(purchase.date),
        quantity: numberValue(purchase.quantity),
        unitCost: numberValue(purchase.unitCost),
        transportCost: numberValue(purchase.transportCost),
        otherCost: numberValue(purchase.otherCost),
        totalCost: numberValue(purchase.totalCost),
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/sales", async (req, res, next) => {
  try {
    const { limit = 20 } = ListSalesQueryParams.parse(req.query);
    const rows = await db
      .select({
        id: salesTable.id,
        date: salesTable.date,
        customer: salesTable.customer,
        productId: salesTable.productId,
        productName: productsTable.name,
        quantity: salesTable.quantity,
        unitPrice: salesTable.unitPrice,
        totalAmount: salesTable.totalAmount,
        unitCost: salesTable.unitCost,
        profit: salesTable.profit,
        receivedAmount: salesTable.receivedAmount,
        dueAmount: salesTable.dueAmount,
        status: salesTable.status,
      })
      .from(salesTable)
      .innerJoin(productsTable, eq(productsTable.id, salesTable.productId))
      .orderBy(desc(salesTable.date), desc(salesTable.id))
      .limit(limit);
    res.json(
      ListSalesResponse.parse(
        rows.map((row) => ({
          ...row,
          date: dateValue(row.date),
          quantity: numberValue(row.quantity),
          unitPrice: numberValue(row.unitPrice),
          totalAmount: numberValue(row.totalAmount),
          unitCost: numberValue(row.unitCost),
          profit: numberValue(row.profit),
          receivedAmount: numberValue(row.receivedAmount),
          dueAmount: numberValue(row.dueAmount),
        })),
      ),
    );
  } catch (error) {
    next(error);
  }
});

router.post("/sales", async (req, res, next) => {
  try {
    const body = CreateSaleBody.parse(req.body);
    const costRows = await db.execute(sql`
      SELECT COALESCE(SUM(total_cost) / NULLIF(SUM(quantity), 0), 0) AS "unitCost"
      FROM business_purchases
      WHERE product_id = ${body.productId}
    `);
    const unitCost = numberValue(resultRows(costRows)[0]?.unitCost);
    const totalAmount = body.quantity * body.unitPrice;
    const receivedAmount = Math.min(body.receivedAmount ?? 0, totalAmount);
    const dueAmount = Math.max(totalAmount - receivedAmount, 0);
    const profit = totalAmount - body.quantity * unitCost;
    const [created] = await db
      .insert(salesTable)
      .values({
        date: String(body.date),
        customer: body.customer,
        productId: body.productId,
        quantity: String(body.quantity),
        unitPrice: String(body.unitPrice),
        totalAmount: String(totalAmount),
        unitCost: String(unitCost),
        profit: String(profit),
        receivedAmount: String(receivedAmount),
        dueAmount: String(dueAmount),
        status: dueAmount > 0 ? "due" : "paid",
      })
      .returning({ id: salesTable.id });
    const row = await db
      .select({
        id: salesTable.id,
        date: salesTable.date,
        customer: salesTable.customer,
        productId: salesTable.productId,
        productName: productsTable.name,
        quantity: salesTable.quantity,
        unitPrice: salesTable.unitPrice,
        totalAmount: salesTable.totalAmount,
        unitCost: salesTable.unitCost,
        profit: salesTable.profit,
        receivedAmount: salesTable.receivedAmount,
        dueAmount: salesTable.dueAmount,
        status: salesTable.status,
      })
      .from(salesTable)
      .innerJoin(productsTable, eq(productsTable.id, salesTable.productId))
      .where(eq(salesTable.id, created.id));
    const sale = row[0];
    res.status(201).json(
      CreateSaleResponse.parse({
        ...sale,
        date: dateValue(sale.date),
        quantity: numberValue(sale.quantity),
        unitPrice: numberValue(sale.unitPrice),
        totalAmount: numberValue(sale.totalAmount),
        unitCost: numberValue(sale.unitCost),
        profit: numberValue(sale.profit),
        receivedAmount: numberValue(sale.receivedAmount),
        dueAmount: numberValue(sale.dueAmount),
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/expenses", async (req, res, next) => {
  try {
    const { limit = 20 } = ListExpensesQueryParams.parse(req.query);
    const rows = await db
      .select({
        id: expensesTable.id,
        date: expensesTable.date,
        category: expensesTable.category,
        description: expensesTable.description,
        amount: expensesTable.amount,
      })
      .from(expensesTable)
      .orderBy(desc(expensesTable.date), desc(expensesTable.id))
      .limit(limit);
    res.json(
      ListExpensesResponse.parse(
        rows.map((row) => ({
          ...row,
          date: dateValue(row.date),
          amount: numberValue(row.amount),
        })),
      ),
    );
  } catch (error) {
    next(error);
  }
});

router.post("/expenses", async (req, res, next) => {
  try {
    const body = CreateExpenseBody.parse(req.body);
    const [expense] = await db
      .insert(expensesTable)
      .values({
        date: String(body.date),
        category: body.category,
        description: body.description,
        amount: String(body.amount),
      })
      .returning({
        id: expensesTable.id,
        date: expensesTable.date,
        category: expensesTable.category,
        description: expensesTable.description,
        amount: expensesTable.amount,
      });
    res.status(201).json(
      CreateExpenseResponse.parse({
        ...expense,
        date: dateValue(expense.date),
        amount: numberValue(expense.amount),
      }),
    );
  } catch (error) {
    next(error);
  }
});

export default router;