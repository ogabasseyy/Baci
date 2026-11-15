interface VerifierConnection {
  query(sql: string): Promise<unknown>;
}
/** Test-fixture proof writes always restore a usable connection before reuse. */
export async function runVerifierTransaction<T>(
  connection: VerifierConnection,
  write: () => Promise<T>
): Promise<T> {
  await connection.query('BEGIN');
  try {
    await connection.query('SET LOCAL ROLE baci_experience_verifier');
    const result = await write();
    await connection.query('COMMIT');
    return result;
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  }
}
