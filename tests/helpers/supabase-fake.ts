// A small stand-in for the Supabase service-role client, enough for the query
// shapes the catalog actions use: a filtered read, maybeSingle, a list, and rpc.
//
// Every call is recorded so a test can assert what the action actually asked
// for, and each table answers with whatever the test configured.

export type DbError = { message: string }

export type DbResponse = { data: unknown; error: DbError | null }

export type TableAnswer =
  | DbResponse
  | ((context: { single: boolean; filters: Record<string, unknown> }) => DbResponse)

export interface TableQuery {
  table: string
  filters: Record<string, unknown>
  single: boolean
}

export interface FakeSupabaseOptions {
  tables?: Record<string, TableAnswer>
  rpc?: (name: string, args: Record<string, unknown>) => DbResponse | Promise<DbResponse>
}

export interface FakeSupabase {
  client: unknown
  rpcCalls: { name: string; args: Record<string, unknown> }[]
  tableQueries: TableQuery[]
}

const EMPTY: DbResponse = { data: null, error: null }

export function createSupabaseFake(options: FakeSupabaseOptions = {}): FakeSupabase {
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = []
  const tableQueries: TableQuery[] = []

  function answer(table: string, single: boolean, filters: Record<string, unknown>): DbResponse {
    const configured = options.tables?.[table]

    if (configured === undefined) {
      return single ? { data: null, error: null } : { data: [], error: null }
    }

    return typeof configured === "function" ? configured({ single, filters }) : configured
  }

  function builder(table: string) {
    const filters: Record<string, unknown> = {}
    let single = false

    const record = (): void => {
      tableQueries.push({ table, filters, single })
    }

    const resolve = (): DbResponse => {
      record()

      return answer(table, single, filters)
    }

    const api = {
      select: () => api,
      eq: (column: string, value: unknown) => {
        filters[column] = value

        return api
      },
      in: (column: string, values: unknown) => {
        filters[`${column}:in`] = values

        return api
      },
      or: (expression: string) => {
        filters.or = expression

        return api
      },
      order: () => api,
      limit: () => api,
      maybeSingle: async () => {
        single = true

        return resolve()
      },
      single: async () => {
        single = true

        return resolve()
      },
      // Awaited without a terminal method: this is what a list query does.
      then: (onFulfilled?: (value: DbResponse) => unknown, onRejected?: (reason: unknown) => unknown) => {
        return Promise.resolve(resolve()).then(onFulfilled, onRejected)
      },
    }

    return api
  }

  const client = {
    from: (table: string) => builder(table),
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ name, args })

      return options.rpc ? options.rpc(name, args) : EMPTY
    },
  }

  return { client, rpcCalls, tableQueries }
}
