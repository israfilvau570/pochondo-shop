import {
  date,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const money = (name: string) => numeric(name, { precision: 12, scale: 2 }).notNull().default("0");
const quantity = (name: string) => numeric(name, { precision: 12, scale: 2 }).notNull();

export const productsTable = pgTable("business_products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  unit: text("unit").notNull(),
  minStock: numeric("min_stock", { precision: 12, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const purchasesTable = pgTable("business_purchases", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  supplier: text("supplier").notNull(),
  productId: integer("product_id").notNull().references(() => productsTable.id),
  quantity: quantity("quantity"),
  unitCost: money("unit_cost"),
  transportCost: money("transport_cost"),
  otherCost: money("other_cost"),
  totalCost: money("total_cost"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const salesTable = pgTable("business_sales", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  customer: text("customer").notNull(),
  productId: integer("product_id").notNull().references(() => productsTable.id),
  quantity: quantity("quantity"),
  unitPrice: money("unit_price"),
  totalAmount: money("total_amount"),
  unitCost: money("unit_cost"),
  profit: money("profit"),
  receivedAmount: money("received_amount"),
  dueAmount: money("due_amount"),
  status: text("status").notNull().default("paid"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const expensesTable = pgTable("business_expenses", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  amount: money("amount"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});