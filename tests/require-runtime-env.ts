const enforceRuntime = process.env.CI === 'true' || process.env.REQUIRE_RUNTIME_TESTS === 'true';

if (enforceRuntime) {
  const missing = ['DATABASE_URL', 'REDIS_URL'].filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Runtime test environment is missing: ${missing.join(', ')}`);
  }
}
