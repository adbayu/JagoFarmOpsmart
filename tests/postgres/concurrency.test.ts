import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { postgresDatabase } from "../../src/server/db.js";
import { completeSale } from "../../src/modules/sales/service.js";
import { consumptionFor, fixture, saleFor } from "../fixture.js";
import { consume } from "../../src/modules/inventory/service.js";

test(
  "two connections serialize consumption and sale and replay once",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const url = process.env.TEST_DATABASE_URL!;
    if (!new URL(url).pathname.toLowerCase().includes("test"))
      throw new Error("Use a dedicated database whose name contains test");
    const schema = `opsmart_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Pool({ connectionString: url });
    const pool = new pg.Pool({
      connectionString: url,
      max: 4,
      options: `-c search_path=${schema}`,
    });
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      for (const name of (await readdir("db/migrations"))
        .filter((n) => n.endsWith(".sql"))
        .sort())
        await pool.query(await readFile(`db/migrations/${name}`, "utf8"));
      const f = await fixture(pool),
        db = postgresDatabase(pool);
      const results = await Promise.allSettled([
        completeSale(db, f, saleFor(f, "7")),
        completeSale(db, f, saleFor(f, "7")),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        (
          await pool.query(
            "SELECT COUNT(*)::text AS count FROM sale WHERE farm_id=$1",
            [f.farmId],
          )
        ).rows[0].count,
        "1",
      );
      assert.equal(
        (
          await pool.query(
            "SELECT quantity::text FROM stock_balance WHERE farm_id=$1",
            [f.farmId],
          )
        ).rows[0].quantity,
        "3.000",
      );
      const consumptions = await Promise.allSettled([
        consume(db, f, consumptionFor(f, "2")),
        consume(db, f, consumptionFor(f, "2")),
      ]);
      assert.equal(
        consumptions.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT COUNT(*)::text AS count FROM consumption WHERE farm_id=$1",
            [f.farmId],
          )
        ).rows[0].count,
        "1",
      );
      assert.equal(
        (
          await pool.query(
            "SELECT quantity::text FROM stock_balance WHERE farm_id=$1",
            [f.farmId],
          )
        ).rows[0].quantity,
        "1.000",
      );
      const input = saleFor(f, "1");
      const [a, b] = await Promise.all([
        completeSale(db, f, input),
        completeSale(db, f, input),
      ]);
      assert.deepEqual(a, b);
      assert.equal(
        (
          await pool.query(
            "SELECT COUNT(*)::text AS count FROM sale WHERE farm_id=$1",
            [f.farmId],
          )
        ).rows[0].count,
        "2",
      );
      assert.equal(
        (
          await pool.query(
            "SELECT quantity::text FROM stock_balance WHERE farm_id=$1",
            [f.farmId],
          )
        ).rows[0].quantity,
        "0.000",
      );
    } finally {
      await pool.end();
      // Only this generated, validated schema in the explicitly selected test DB is removed.
      if (!/^opsmart_test_[a-f0-9]{32}$/.test(schema))
        throw new Error("Invalid test schema");
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  },
);
