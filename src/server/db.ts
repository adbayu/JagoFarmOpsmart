import pg from "pg";
/** Small SQL port: production pg and test PGlite share the same transaction services. */
export interface Sql {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}
export interface Database {
  transaction<T>(work: (tx: Sql) => Promise<T>): Promise<T>;
}
export function postgresDatabase(pool: pg.Pool): Database {
  return {
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        const result = await work(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
