import postgres from "postgres";
import type { Sql } from "./executor";

export interface PostgresOptions {
  /** Max pooled connections (keep small: Supabase's free pooler is shared). */
  max?: number;
  /**
   * Disable prepared statements. Required behind transaction-mode poolers
   * (Supabase port 6543); harmless elsewhere.
   */
  prepare?: boolean;
}

export function createPostgresSql(connectionString: string, opts: PostgresOptions = {}): Sql {
  const client = postgres(connectionString, {
    max: opts.max ?? 3,
    prepare: opts.prepare ?? false,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (x: number) => String(x),
        parse: (x: string) => Number(x),
      },
    },
  });
  return wrap(client, client);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- custom type map varies
type Client = postgres.Sql<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TxClient = postgres.TransactionSql<any>;

function wrap(root: Client, conn: Client | TxClient): Sql {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await conn.unsafe(text, params as postgres.ParameterOrJSON<never>[])) as unknown as T[];
    },
    async exec(script: string) {
      await conn.unsafe(script);
    },
    async transaction<R>(fn: (tx: Sql) => Promise<R>): Promise<R> {
      if ("savepoint" in conn) return fn(wrap(root, conn));
      return (await root.begin((tx) => fn(wrap(root, tx)))) as R;
    },
    async close() {
      await root.end({ timeout: 5 });
    },
  };
}
