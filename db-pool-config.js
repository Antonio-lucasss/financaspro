/** Supabase shared pooler configuration for short, independent API queries. */
function getPoolConfig(connectionString) {
  const url = new URL(connectionString);
  // Only normalize the verified shared Supabase endpoint. Local Postgres,
  // direct connections and other providers retain their original settings.
  if (url.hostname.endsWith('.pooler.supabase.com') && (!url.port || url.port === '5432')) {
    url.port = '6543';
    connectionString = url.toString();
  }
  return {
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 1,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 10000,
  };
}

module.exports = { getPoolConfig };
