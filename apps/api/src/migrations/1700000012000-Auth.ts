import { MigrationInterface, QueryRunner } from 'typeorm';

export class Auth1700000012000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255),
        name VARCHAR(255),
        role VARCHAR(20) NOT NULL DEFAULT 'user',
        plan VARCHAR(20) NOT NULL DEFAULT 'free',
        google_id VARCHAR(255) UNIQUE,
        avatar_url VARCHAR(500),
        investigation_count INT NOT NULL DEFAULT 0,
        investigation_limit INT NOT NULL DEFAULT 5,
        logo_url VARCHAR(500),
        company_name VARCHAR(255),
        stripe_customer_id VARCHAR(255),
        stripe_subscription_id VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_login_at TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users (email)`);

    // Audit trail
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        action VARCHAR(50) NOT NULL,
        resource_type VARCHAR(50),
        resource_id VARCHAR(255),
        details JSONB DEFAULT '{}',
        ip_address VARCHAR(50),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log (user_id, created_at DESC)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log (resource_type, resource_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS audit_log');
    await queryRunner.query('DROP TABLE IF EXISTS users');
  }
}
