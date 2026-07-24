declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    LATTICE_R2_ACCOUNT_ID: string;
    LATTICE_R2_ACCESS_KEY_ID: string;
    LATTICE_R2_SECRET_ACCESS_KEY: string;
    LATTICE_R2_BUCKET: string;
  }
}
